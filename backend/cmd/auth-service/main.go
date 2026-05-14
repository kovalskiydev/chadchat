package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"backend/internal/mysqlutil"
	"backend/internal/rateutil"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const (
	userTypeAnonymous  = "anonymous"
	userTypeRegistered = "registered"
	userRoleUser       = "user"
	userRoleAdmin      = "admin"
	accessTokenTTL     = 15 * time.Minute
	refreshTokenTTL    = 30 * 24 * time.Hour
)

type User struct {
	ID                 string    `json:"id"`
	Nickname           string    `json:"nickname,omitempty"`
	PasswordHash       string    `json:"-"`
	Type               string    `json:"type"`
	Role               string    `json:"role"`
	VerificationStatus string    `json:"verification_status"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

type RefreshSession struct {
	TokenHash string
	UserID    string
	ExpiresAt time.Time
	RevokedAt *time.Time
}

type Server struct {
	db                  *sql.DB
	accessKey           []byte
	refreshKey          []byte
	verificationBaseURL string
	verificationSecret  string
	limiter             *rateutil.Limiter
}

type credentialsRequest struct {
	Nickname          string `json:"nickname"`
	Password          string `json:"password"`
	VerificationToken string `json:"verification_token"`
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type authResponse struct {
	User         *User  `json:"user"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresInSec int64  `json:"expires_in_sec"`
}

type tokenPair struct {
	AccessToken  string
	RefreshToken string
}

func main() {
	db, err := mysqlutil.OpenFromEnv()
	if err != nil {
		log.Fatalf("open mysql: %v", err)
	}

	if err := mysqlutil.ExecStatements(db, authSchema()); err != nil {
		log.Fatalf("auth schema: %v", err)
	}
	if err := ensureAuthSchema(db); err != nil {
		log.Fatalf("auth schema: %v", err)
	}

	s := &Server{
		db:                  db,
		accessKey:           secretOrRandom("AUTH_ACCESS_TOKEN_SECRET"),
		refreshKey:          secretOrRandom("AUTH_REFRESH_TOKEN_SECRET"),
		verificationBaseURL: envOr("VERIFICATION_SERVICE_URL", "http://localhost:8082"),
		verificationSecret:  envOr("VERIFICATION_INTERNAL_SECRET", "dev-internal-secret-change-me"),
		limiter:             rateutil.NewLimiter(),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("POST /auth/anonymous", s.withRateLimit(10, time.Minute, s.handleAnonymous))
	mux.HandleFunc("POST /auth/register", s.withRateLimit(10, time.Minute, s.handleRegister))
	mux.HandleFunc("POST /auth/login", s.withRateLimit(20, time.Minute, s.handleLogin))
	mux.HandleFunc("POST /auth/upgrade", s.withRateLimit(10, time.Minute, s.withAuth(s.handleUpgrade)))
	mux.HandleFunc("POST /auth/refresh", s.withRateLimit(60, time.Minute, s.handleRefresh))
	mux.HandleFunc("POST /auth/logout", s.withRateLimit(60, time.Minute, s.handleLogout))
	mux.HandleFunc("GET /me", s.withAuth(s.handleMe))

	addr := ":" + envOr("PORT", "8081")
	log.Printf("auth-service on %s", addr)
	log.Fatal(http.ListenAndServe(addr, withJSON(mux)))
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	if err := mysqlutil.Ping(s.db); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"ok":     false,
			"status": "degraded",
			"error":  "mysql_unavailable",
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"status": "ok",
		"checks": map[string]string{
			"mysql": "ok",
		},
	})
}

func authSchema() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS users (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
			nickname VARCHAR(64) NULL UNIQUE,
			password_hash VARCHAR(255) NULL,
			type VARCHAR(32) NOT NULL,
			role VARCHAR(32) NOT NULL DEFAULT 'user',
			verification_status VARCHAR(32) NOT NULL,
			created_at DATETIME(6) NOT NULL,
			updated_at DATETIME(6) NOT NULL
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS refresh_sessions (
			token_hash CHAR(64) NOT NULL PRIMARY KEY,
			user_id VARCHAR(64) NOT NULL,
			expires_at DATETIME(6) NOT NULL,
			revoked_at DATETIME(6) NULL,
			created_at DATETIME(6) NOT NULL,
			INDEX idx_refresh_user_id (user_id)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
	}
}

func ensureAuthSchema(db *sql.DB) error {
	hasRole, err := mysqlutil.ColumnExists(db, "users", "role")
	if err != nil {
		return err
	}
	if !hasRole {
		if _, err := db.Exec(`ALTER TABLE users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'user' AFTER type`); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) handleAnonymous(w http.ResponseWriter, r *http.Request) {
	var req struct {
		VerificationToken string `json:"verification_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid_json")
		return
	}
	if req.VerificationToken == "" {
		writeErr(w, 400, "verification_required")
		return
	}
	if err := s.consumeVerificationToken(req.VerificationToken); err != nil {
		writeErr(w, 401, "invalid_verification_token")
		return
	}

	now := time.Now().UTC()
	tx, err := s.db.Begin()
	if err != nil {
		writeErr(w, 500, "db_error")
		return
	}
	defer tx.Rollback()

	res, err := tx.Exec(
		`INSERT INTO users (nickname, password_hash, type, role, verification_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		nil, nil, userTypeAnonymous, userRoleUser, "passed", now, now,
	)
	if err != nil {
		writeErr(w, 500, "db_error")
		return
	}

	rawID, err := res.LastInsertId()
	if err != nil {
		writeErr(w, 500, "db_error")
		return
	}
	userID := publicUserID(rawID)
	nickname := generateAnonymousNickname(rawID)

	if _, err := tx.Exec(`UPDATE users SET nickname = ? WHERE id = ?`, nickname, rawID); err != nil {
		writeErr(w, 500, "db_error")
		return
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, 500, "db_error")
		return
	}

	user := &User{
		ID:                 userID,
		Nickname:           nickname,
		Type:               userTypeAnonymous,
		Role:               userRoleUser,
		VerificationStatus: "passed",
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	s.respondWithTokens(w, user)
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req credentialsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid_json")
		return
	}
	nick, err := validateNickname(req.Nickname)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if err := validatePassword(req.Password); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if req.VerificationToken == "" {
		writeErr(w, 400, "verification_required")
		return
	}
	if err := s.consumeVerificationToken(req.VerificationToken); err != nil {
		writeErr(w, 401, "invalid_verification_token")
		return
	}

	hash, err := hashPassword(req.Password)
	if err != nil {
		writeErr(w, 500, "hash_failed")
		return
	}

	now := time.Now().UTC()
	res, err := s.db.Exec(
		`INSERT INTO users (nickname, password_hash, type, role, verification_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		nick, hash, userTypeRegistered, userRoleUser, "passed", now, now,
	)
	if err != nil {
		if isDuplicateErr(err) {
			writeErr(w, 409, "nickname_taken")
			return
		}
		writeErr(w, 500, "db_error")
		return
	}
	rawID, err := res.LastInsertId()
	if err != nil {
		writeErr(w, 500, "db_error")
		return
	}
	user := &User{
		ID:                 publicUserID(rawID),
		Nickname:           nick,
		PasswordHash:       hash,
		Type:               userTypeRegistered,
		Role:               userRoleUser,
		VerificationStatus: "passed",
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	s.respondWithTokens(w, user)
}

func (s *Server) handleUpgrade(w http.ResponseWriter, r *http.Request, user *User) {
	if user.Type != userTypeAnonymous {
		writeErr(w, 400, "already_registered")
		return
	}

	var req credentialsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid_json")
		return
	}
	nick, err := validateNickname(req.Nickname)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if err := validatePassword(req.Password); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	hash, err := hashPassword(req.Password)
	if err != nil {
		writeErr(w, 500, "hash_failed")
		return
	}

	now := time.Now().UTC()
	rawID, err := internalUserID(user.ID)
	if err != nil {
		writeErr(w, 400, "invalid_user_id")
		return
	}

	_, err = s.db.Exec(
		`UPDATE users
		 SET nickname = ?, password_hash = ?, type = ?, verification_status = ?, updated_at = ?
		 WHERE id = ? AND type = ?`,
		nick, hash, userTypeRegistered, "passed", now, rawID, userTypeAnonymous,
	)
	if err != nil {
		if isDuplicateErr(err) {
			writeErr(w, 409, "nickname_taken")
			return
		}
		writeErr(w, 500, "db_error")
		return
	}

	user.Nickname = nick
	user.PasswordHash = hash
	user.Type = userTypeRegistered
	user.VerificationStatus = "passed"
	user.UpdatedAt = now

	tokens, err := s.issueTokens(user.ID)
	if err != nil {
		writeErr(w, 500, "token_issue_failed")
		return
	}
	writeJSON(w, 200, authResponse{
		User:         user,
		AccessToken:  tokens.AccessToken,
		RefreshToken: tokens.RefreshToken,
		ExpiresInSec: int64(accessTokenTTL / time.Second),
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req credentialsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid_json")
		return
	}

	user, err := s.findUserByNickname(normalizeNickname(req.Nickname))
	if err != nil {
		writeErr(w, 401, "invalid_credentials")
		return
	}
	if !verifyPassword(req.Password, user.PasswordHash) {
		writeErr(w, 401, "invalid_credentials")
		return
	}

	s.respondWithTokens(w, user)
}

func (s *Server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid_json")
		return
	}
	uid, err := s.verifyRefreshToken(req.RefreshToken)
	if err != nil {
		writeErr(w, 401, "invalid_refresh_token")
		return
	}

	tokenHash := hexSHA256(req.RefreshToken)
	var session RefreshSession
	var revokedAt sql.NullTime
	err = s.db.QueryRow(
		`SELECT token_hash, user_id, expires_at, revoked_at
		 FROM refresh_sessions WHERE token_hash = ?`,
		tokenHash,
	).Scan(&session.TokenHash, &session.UserID, &session.ExpiresAt, &revokedAt)
	if err != nil || session.UserID != uid || revokedAt.Valid || session.ExpiresAt.Before(time.Now().UTC()) {
		writeErr(w, 401, "invalid_refresh_token")
		return
	}

	now := time.Now().UTC()
	if _, err := s.db.Exec(`UPDATE refresh_sessions SET revoked_at = ? WHERE token_hash = ?`, now, tokenHash); err != nil {
		writeErr(w, 500, "db_error")
		return
	}

	user, err := s.findUserByID(uid)
	if err != nil {
		writeErr(w, 401, "invalid_refresh_token")
		return
	}

	tokens, err := s.issueTokens(uid)
	if err != nil {
		writeErr(w, 500, "token_issue_failed")
		return
	}

	writeJSON(w, 200, authResponse{
		User:         user,
		AccessToken:  tokens.AccessToken,
		RefreshToken: tokens.RefreshToken,
		ExpiresInSec: int64(accessTokenTTL / time.Second),
	})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid_json")
		return
	}

	now := time.Now().UTC()
	_, _ = s.db.Exec(`UPDATE refresh_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`, now, hexSHA256(req.RefreshToken))
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

func (s *Server) handleMe(w http.ResponseWriter, _ *http.Request, user *User) {
	writeJSON(w, 200, map[string]*User{"user": user})
}

func (s *Server) consumeVerificationToken(token string) error {
	payload, _ := json.Marshal(map[string]string{"verification_token": token})
	req, err := http.NewRequest(http.MethodPost, s.verificationBaseURL+"/verification/consume", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Verification-Secret", s.verificationSecret)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return errors.New("consume_failed")
	}
	return nil
}

func (s *Server) withAuth(next func(http.ResponseWriter, *http.Request, *User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			writeErr(w, 401, "missing_bearer_token")
			return
		}
		userID, err := s.verifyAccessToken(strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer ")))
		if err != nil {
			writeErr(w, 401, "invalid_access_token")
			return
		}
		user, err := s.findUserByID(userID)
		if err != nil {
			writeErr(w, 401, "invalid_access_token")
			return
		}
		next(w, r, user)
	}
}

func (s *Server) withRateLimit(limit int, window time.Duration, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := r.Method + ":" + r.URL.Path + ":" + rateutil.ClientKey(r)
		if !s.limiter.Allow(key, limit, window) {
			writeErr(w, http.StatusTooManyRequests, "rate_limited")
			return
		}
		next(w, r)
	}
}

func (s *Server) respondWithTokens(w http.ResponseWriter, user *User) {
	tokens, err := s.issueTokens(user.ID)
	if err != nil {
		writeErr(w, 500, "token_issue_failed")
		return
	}
	writeJSON(w, 200, authResponse{
		User:         user,
		AccessToken:  tokens.AccessToken,
		RefreshToken: tokens.RefreshToken,
		ExpiresInSec: int64(accessTokenTTL / time.Second),
	})
}

func (s *Server) issueTokens(userID string) (*tokenPair, error) {
	now := time.Now().UTC()
	accessToken, err := signToken("acc", userID, now.Add(accessTokenTTL), s.accessKey)
	if err != nil {
		return nil, err
	}
	refreshToken, err := signToken("ref", userID, now.Add(refreshTokenTTL), s.refreshKey)
	if err != nil {
		return nil, err
	}
	if _, err := s.db.Exec(
		`INSERT INTO refresh_sessions (token_hash, user_id, expires_at, revoked_at, created_at)
		 VALUES (?, ?, ?, NULL, ?)`,
		hexSHA256(refreshToken), userID, now.Add(refreshTokenTTL), now,
	); err != nil {
		return nil, err
	}
	return &tokenPair{AccessToken: accessToken, RefreshToken: refreshToken}, nil
}

func (s *Server) verifyAccessToken(token string) (string, error) {
	return verifyToken("acc", token, s.accessKey)
}

func (s *Server) verifyRefreshToken(token string) (string, error) {
	return verifyToken("ref", token, s.refreshKey)
}

func (s *Server) findUserByID(id string) (*User, error) {
	rawID, err := internalUserID(id)
	if err != nil {
		return nil, err
	}

	var user User
	var nickname, passwordHash sql.NullString
	var createdAt, updatedAt time.Time
	var userType, role, verificationStatus string
	err = s.db.QueryRow(
		`SELECT nickname, password_hash, type, role, verification_status, created_at, updated_at
		 FROM users WHERE id = ?`,
		rawID,
	).Scan(&nickname, &passwordHash, &userType, &role, &verificationStatus, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}

	user = User{
		ID:                 id,
		Nickname:           nickname.String,
		PasswordHash:       passwordHash.String,
		Type:               userType,
		Role:               normalizeUserRole(role),
		VerificationStatus: verificationStatus,
		CreatedAt:          createdAt,
		UpdatedAt:          updatedAt,
	}
	return &user, nil
}

func (s *Server) findUserByNickname(nickname string) (*User, error) {
	var rawID int64
	var nick, passwordHash sql.NullString
	var userType, role, verificationStatus string
	var createdAt, updatedAt time.Time
	err := s.db.QueryRow(
		`SELECT id, nickname, password_hash, type, role, verification_status, created_at, updated_at
		 FROM users WHERE nickname = ?`,
		nickname,
	).Scan(&rawID, &nick, &passwordHash, &userType, &role, &verificationStatus, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	user := &User{
		ID:                 publicUserID(rawID),
		Nickname:           nick.String,
		PasswordHash:       passwordHash.String,
		Type:               userType,
		Role:               normalizeUserRole(role),
		VerificationStatus: verificationStatus,
		CreatedAt:          createdAt,
		UpdatedAt:          updatedAt,
	}
	return user, nil
}

func withJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeErr(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func secretOrRandom(key string) []byte {
	if value := os.Getenv(key); value != "" {
		return []byte(value)
	}
	buf := make([]byte, 32)
	_, _ = rand.Read(buf)
	log.Printf("warning: %s is not set, tokens will be invalidated on restart", key)
	return buf
}

func normalizeNickname(n string) string { return strings.ToLower(strings.TrimSpace(n)) }

func normalizeUserRole(role string) string {
	switch strings.TrimSpace(strings.ToLower(role)) {
	case userRoleAdmin:
		return userRoleAdmin
	default:
		return userRoleUser
	}
}

func validateNickname(n string) (string, error) {
	nn := normalizeNickname(n)
	if len(nn) < 3 || len(nn) > 24 {
		return "", errors.New("invalid_nickname")
	}
	for _, r := range nn {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '_' && r != '-' {
			return "", errors.New("invalid_nickname")
		}
	}
	return nn, nil
}

func validatePassword(password string) error {
	if len(password) < 8 {
		return errors.New("weak_password")
	}
	return nil
}

func hashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func verifyPassword(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

func signToken(kind, userID string, exp time.Time, key []byte) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": userID,
		"typ": kind,
		"iss": "auth-service",
		"iat": time.Now().UTC().Unix(),
		"exp": exp.Unix(),
		"jti": randomTokenID(),
	})
	return token.SignedString(key)
}

func verifyToken(kind, tokenString string, key []byte) (string, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (any, error) {
		if token.Method == nil || token.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, errors.New("unexpected_signing_method")
		}
		return key, nil
	})
	if err != nil || !token.Valid {
		return "", errors.New("invalid_token")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", errors.New("invalid_claims")
	}
	claimType, ok := claims["typ"].(string)
	if !ok || claimType != kind {
		return "", errors.New("invalid_token_type")
	}
	sub, ok := claims["sub"].(string)
	if !ok || sub == "" {
		return "", errors.New("missing_subject")
	}
	return sub, nil
}

func hexSHA256(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func randomTokenID() string {
	buf := make([]byte, 16)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}

func publicUserID(rawID int64) string {
	return fmt.Sprintf("u_%d", rawID)
}

func internalUserID(publicID string) (int64, error) {
	if !strings.HasPrefix(publicID, "u_") {
		return 0, errors.New("invalid_public_user_id")
	}
	return strconv.ParseInt(strings.TrimPrefix(publicID, "u_"), 10, 64)
}

func generateAnonymousNickname(rawID int64) string {
	return fmt.Sprintf("anonymys #%d", rawID)
}

func isDuplicateErr(err error) bool {
	return strings.Contains(strings.ToLower(err.Error()), "duplicate")
}
