package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"backend/internal/rateutil"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const (
	userTypeAnonymous  = "anonymous"
	userTypeRegistered = "registered"
	accessTokenTTL     = 15 * time.Minute
	refreshTokenTTL    = 30 * 24 * time.Hour
)

type User struct {
	ID                 string    `json:"id"`
	Nickname           string    `json:"nickname,omitempty"`
	PasswordHash       string    `json:"-"`
	Type               string    `json:"type"`
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

type Store struct {
	mu                 sync.RWMutex
	usersByID          map[string]*User
	registeredByNick   map[string]string
	refreshByTokenHash map[string]*RefreshSession
	seq                atomic.Uint64
}

type Server struct {
	store               *Store
	accessKey           []byte
	refreshKey          []byte
	verificationBaseURL string
	verificationSecret  string
	limiter             *rateutil.Limiter
}

func main() {
	verificationURL := envOr("VERIFICATION_SERVICE_URL", "http://localhost:8082")
	accessKey := secretOrRandom("AUTH_ACCESS_TOKEN_SECRET")
	refreshKey := secretOrRandom("AUTH_REFRESH_TOKEN_SECRET")

	s := &Server{
		store:               &Store{usersByID: map[string]*User{}, registeredByNick: map[string]string{}, refreshByTokenHash: map[string]*RefreshSession{}},
		accessKey:           accessKey,
		refreshKey:          refreshKey,
		verificationBaseURL: verificationURL,
		verificationSecret:  envOr("VERIFICATION_INTERNAL_SECRET", "dev-internal-secret-change-me"),
		limiter:             rateutil.NewLimiter(),
	}

	mux := http.NewServeMux()
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

func (s *Store) nextUserID() string { return fmt.Sprintf("u_%d", s.seq.Add(1)) }

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
	userID := s.store.nextUserID()
	user := &User{
		ID:                 userID,
		Nickname:           generateAnonymousNickname(userID),
		Type:               userTypeAnonymous,
		VerificationStatus: "passed",
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	s.store.mu.Lock()
	s.store.usersByID[user.ID] = user
	s.store.mu.Unlock()
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
	user := &User{ID: s.store.nextUserID(), Nickname: nick, PasswordHash: hash, Type: userTypeRegistered, VerificationStatus: "passed", CreatedAt: now, UpdatedAt: now}

	s.store.mu.Lock()
	if _, ok := s.store.registeredByNick[nick]; ok {
		s.store.mu.Unlock()
		writeErr(w, 409, "nickname_taken")
		return
	}
	s.store.registeredByNick[nick] = user.ID
	s.store.usersByID[user.ID] = user
	s.store.mu.Unlock()
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

	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	if _, ok := s.store.registeredByNick[nick]; ok {
		writeErr(w, 409, "nickname_taken")
		return
	}
	user.Nickname, user.PasswordHash = nick, hash
	user.Type, user.VerificationStatus, user.UpdatedAt = userTypeRegistered, "passed", time.Now().UTC()
	s.store.registeredByNick[nick] = user.ID
	t, err := s.issueTokensLocked(user.ID)
	if err != nil {
		writeErr(w, 500, "token_issue_failed")
		return
	}
	writeJSON(w, 200, authResponse{User: user, AccessToken: t.AccessToken, RefreshToken: t.RefreshToken, ExpiresInSec: int64(accessTokenTTL / time.Second)})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req credentialsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid_json")
		return
	}
	nick := normalizeNickname(req.Nickname)
	s.store.mu.RLock()
	uid, ok := s.store.registeredByNick[nick]
	if !ok {
		s.store.mu.RUnlock()
		writeErr(w, 401, "invalid_credentials")
		return
	}
	user := s.store.usersByID[uid]
	s.store.mu.RUnlock()
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
	th := hexSHA256(req.RefreshToken)
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	rs, ok := s.store.refreshByTokenHash[th]
	if !ok || rs.UserID != uid || rs.RevokedAt != nil || rs.ExpiresAt.Before(time.Now().UTC()) {
		writeErr(w, 401, "invalid_refresh_token")
		return
	}
	now := time.Now().UTC()
	rs.RevokedAt = &now
	user := s.store.usersByID[uid]
	t, err := s.issueTokensLocked(uid)
	if err != nil {
		writeErr(w, 500, "token_issue_failed")
		return
	}
	writeJSON(w, 200, authResponse{User: user, AccessToken: t.AccessToken, RefreshToken: t.RefreshToken, ExpiresInSec: int64(accessTokenTTL / time.Second)})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid_json")
		return
	}
	th := hexSHA256(req.RefreshToken)
	s.store.mu.Lock()
	if rs, ok := s.store.refreshByTokenHash[th]; ok && rs.RevokedAt == nil {
		now := time.Now().UTC()
		rs.RevokedAt = &now
	}
	s.store.mu.Unlock()
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
		h := r.Header.Get("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			writeErr(w, 401, "missing_bearer_token")
			return
		}
		uid, err := s.verifyAccessToken(strings.TrimSpace(strings.TrimPrefix(h, "Bearer ")))
		if err != nil {
			writeErr(w, 401, "invalid_access_token")
			return
		}
		s.store.mu.RLock()
		user, ok := s.store.usersByID[uid]
		s.store.mu.RUnlock()
		if !ok {
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

type tokenPair struct{ AccessToken, RefreshToken string }

func (s *Server) respondWithTokens(w http.ResponseWriter, user *User) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	t, err := s.issueTokensLocked(user.ID)
	if err != nil {
		writeErr(w, 500, "token_issue_failed")
		return
	}
	writeJSON(w, 200, authResponse{User: user, AccessToken: t.AccessToken, RefreshToken: t.RefreshToken, ExpiresInSec: int64(accessTokenTTL / time.Second)})
}

func (s *Server) issueTokensLocked(uid string) (*tokenPair, error) {
	acc, err := signToken("acc", uid, time.Now().UTC().Add(accessTokenTTL), s.accessKey)
	if err != nil {
		return nil, err
	}
	ref, err := signToken("ref", uid, time.Now().UTC().Add(refreshTokenTTL), s.refreshKey)
	if err != nil {
		return nil, err
	}
	s.store.refreshByTokenHash[hexSHA256(ref)] = &RefreshSession{TokenHash: hexSHA256(ref), UserID: uid, ExpiresAt: time.Now().UTC().Add(refreshTokenTTL)}
	return &tokenPair{AccessToken: acc, RefreshToken: ref}, nil
}

func (s *Server) verifyAccessToken(t string) (string, error) {
	return verifyToken("acc", t, s.accessKey)
}
func (s *Server) verifyRefreshToken(t string) (string, error) {
	return verifyToken("ref", t, s.refreshKey)
}

func withJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		next.ServeHTTP(w, r)
	})
}
func writeJSON(w http.ResponseWriter, status int, p any) {
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(p)
}
func writeErr(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}
func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
func secretOrRandom(k string) []byte {
	if v := os.Getenv(k); v != "" {
		return []byte(v)
	}
	buf := make([]byte, 32)
	_, _ = rand.Read(buf)
	log.Printf("warning: %s is not set, tokens will be invalidated on restart", k)
	return buf
}
func normalizeNickname(n string) string { return strings.ToLower(strings.TrimSpace(n)) }
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
func validatePassword(p string) error {
	if len(p) < 8 {
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
func signToken(kind, uid string, exp time.Time, key []byte) (string, error) {
	claims := jwt.MapClaims{
		"sub": uid,
		"typ": kind,
		"iss": "auth-service",
		"iat": time.Now().UTC().Unix(),
		"exp": exp.Unix(),
		"jti": randomTokenID(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(key)
}
func verifyToken(kind, token string, key []byte) (string, error) {
	parsed, err := jwt.Parse(token, func(t *jwt.Token) (any, error) {
		if t.Method == nil || t.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, errors.New("unexpected_signing_method")
		}
		return key, nil
	})
	if err != nil || !parsed.Valid {
		return "", errors.New("invalid_token")
	}

	claims, ok := parsed.Claims.(jwt.MapClaims)
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
func hexSHA256(v string) string { s := sha256.Sum256([]byte(v)); return hex.EncodeToString(s[:]) }

func randomTokenID() string {
	buf := make([]byte, 16)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}

func generateAnonymousNickname(userID string) string {
	numeric := strings.TrimPrefix(userID, "u_")
	return fmt.Sprintf("anonymys #%s", numeric)
}
