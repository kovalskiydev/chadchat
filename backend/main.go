package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	userTypeAnonymous  = "anonymous"
	userTypeRegistered = "registered"

	accessTokenTTL  = 15 * time.Minute
	refreshTokenTTL = 30 * 24 * time.Hour
	passwordMinLen  = 8
)

type User struct {
	ID           string    `json:"id"`
	Nickname     string    `json:"nickname,omitempty"`
	PasswordSalt string    `json:"-"`
	PasswordHash string    `json:"-"`
	Type         string    `json:"type"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
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

func newStore() *Store {
	return &Store{
		usersByID:          make(map[string]*User),
		registeredByNick:   make(map[string]string),
		refreshByTokenHash: make(map[string]*RefreshSession),
	}
}

func (s *Store) nextUserID() string {
	n := s.seq.Add(1)
	return fmt.Sprintf("u_%d", n)
}

type Server struct {
	store      *Store
	accessKey  []byte
	refreshKey []byte
}

func main() {
	server, err := newServer()
	if err != nil {
		log.Fatalf("init server: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /auth/anonymous", server.handleAnonymous)
	mux.HandleFunc("POST /auth/register", server.handleRegister)
	mux.HandleFunc("POST /auth/login", server.handleLogin)
	mux.HandleFunc("POST /auth/refresh", server.handleRefresh)
	mux.HandleFunc("POST /auth/logout", server.handleLogout)
	mux.HandleFunc("POST /auth/upgrade", server.withAuth(server.handleUpgrade))
	mux.HandleFunc("GET /me", server.withAuth(server.handleMe))

	addr := ":8080"
	log.Printf("backend started on %s", addr)
	if err := http.ListenAndServe(addr, withCORS(withJSONContentType(mux))); err != nil {
		log.Fatalf("listen: %v", err)
	}
}

func newServer() (*Server, error) {
	accessKey := make([]byte, 32)
	refreshKey := make([]byte, 32)
	if _, err := rand.Read(accessKey); err != nil {
		return nil, err
	}
	if _, err := rand.Read(refreshKey); err != nil {
		return nil, err
	}
	return &Server{
		store:      newStore(),
		accessKey:  accessKey,
		refreshKey: refreshKey,
	}, nil
}

type authResponse struct {
	User         *User  `json:"user"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresInSec int64  `json:"expires_in_sec"`
}

type credentialsRequest struct {
	Nickname string `json:"nickname"`
	Password string `json:"password"`
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

func (s *Server) handleAnonymous(w http.ResponseWriter, _ *http.Request) {
	user := &User{
		ID:        s.store.nextUserID(),
		Type:      userTypeAnonymous,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}

	s.store.mu.Lock()
	s.store.usersByID[user.ID] = user
	s.store.mu.Unlock()

	s.respondWithTokens(w, user)
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req credentialsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}

	nickname, err := validateNickname(req.Nickname)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validatePassword(req.Password); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	salt, hash, err := hashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash_failed")
		return
	}

	now := time.Now().UTC()
	user := &User{
		ID:           s.store.nextUserID(),
		Nickname:     nickname,
		PasswordSalt: salt,
		PasswordHash: hash,
		Type:         userTypeRegistered,
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	s.store.mu.Lock()
	if _, exists := s.store.registeredByNick[nickname]; exists {
		s.store.mu.Unlock()
		writeError(w, http.StatusConflict, "nickname_taken")
		return
	}
	s.store.usersByID[user.ID] = user
	s.store.registeredByNick[nickname] = user.ID
	s.store.mu.Unlock()

	s.respondWithTokens(w, user)
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req credentialsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}

	nickname := normalizeNickname(req.Nickname)
	if nickname == "" {
		writeError(w, http.StatusBadRequest, "invalid_nickname")
		return
	}

	s.store.mu.RLock()
	userID, exists := s.store.registeredByNick[nickname]
	if !exists {
		s.store.mu.RUnlock()
		writeError(w, http.StatusUnauthorized, "invalid_credentials")
		return
	}
	user := s.store.usersByID[userID]
	s.store.mu.RUnlock()

	if !verifyPassword(req.Password, user.PasswordSalt, user.PasswordHash) {
		writeError(w, http.StatusUnauthorized, "invalid_credentials")
		return
	}

	s.respondWithTokens(w, user)
}

func (s *Server) handleUpgrade(w http.ResponseWriter, r *http.Request, user *User) {
	if user.Type != userTypeAnonymous {
		writeError(w, http.StatusBadRequest, "already_registered")
		return
	}

	var req credentialsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}

	nickname, err := validateNickname(req.Nickname)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validatePassword(req.Password); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	salt, hash, err := hashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash_failed")
		return
	}

	s.store.mu.Lock()
	defer s.store.mu.Unlock()

	if _, exists := s.store.registeredByNick[nickname]; exists {
		writeError(w, http.StatusConflict, "nickname_taken")
		return
	}

	user.Nickname = nickname
	user.PasswordSalt = salt
	user.PasswordHash = hash
	user.Type = userTypeRegistered
	user.UpdatedAt = time.Now().UTC()
	s.store.registeredByNick[nickname] = user.ID

	tokens, err := s.issueTokensLocked(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "token_issue_failed")
		return
	}
	writeJSON(w, http.StatusOK, authResponse{
		User:         user,
		AccessToken:  tokens.AccessToken,
		RefreshToken: tokens.RefreshToken,
		ExpiresInSec: int64(accessTokenTTL / time.Second),
	})
}

func (s *Server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if req.RefreshToken == "" {
		writeError(w, http.StatusBadRequest, "missing_refresh_token")
		return
	}

	userID, err := s.verifyRefreshToken(req.RefreshToken)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid_refresh_token")
		return
	}

	s.store.mu.Lock()
	defer s.store.mu.Unlock()

	tokenHash := hexSHA256(req.RefreshToken)
	session, ok := s.store.refreshByTokenHash[tokenHash]
	if !ok || session.UserID != userID || session.RevokedAt != nil || session.ExpiresAt.Before(time.Now().UTC()) {
		writeError(w, http.StatusUnauthorized, "invalid_refresh_token")
		return
	}
	now := time.Now().UTC()
	session.RevokedAt = &now

	user, ok := s.store.usersByID[userID]
	if !ok {
		writeError(w, http.StatusUnauthorized, "invalid_refresh_token")
		return
	}

	tokens, err := s.issueTokensLocked(userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "token_issue_failed")
		return
	}
	writeJSON(w, http.StatusOK, authResponse{
		User:         user,
		AccessToken:  tokens.AccessToken,
		RefreshToken: tokens.RefreshToken,
		ExpiresInSec: int64(accessTokenTTL / time.Second),
	})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if req.RefreshToken == "" {
		writeError(w, http.StatusBadRequest, "missing_refresh_token")
		return
	}

	tokenHash := hexSHA256(req.RefreshToken)
	s.store.mu.Lock()
	if session, ok := s.store.refreshByTokenHash[tokenHash]; ok && session.RevokedAt == nil {
		now := time.Now().UTC()
		session.RevokedAt = &now
	}
	s.store.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleMe(w http.ResponseWriter, _ *http.Request, user *User) {
	writeJSON(w, http.StatusOK, map[string]*User{"user": user})
}

func (s *Server) respondWithTokens(w http.ResponseWriter, user *User) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	tokens, err := s.issueTokensLocked(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "token_issue_failed")
		return
	}
	writeJSON(w, http.StatusOK, authResponse{
		User:         user,
		AccessToken:  tokens.AccessToken,
		RefreshToken: tokens.RefreshToken,
		ExpiresInSec: int64(accessTokenTTL / time.Second),
	})
}

type tokenPair struct {
	AccessToken  string
	RefreshToken string
}

func (s *Server) issueTokensLocked(userID string) (*tokenPair, error) {
	accessToken, err := s.signAccessToken(userID, time.Now().UTC().Add(accessTokenTTL))
	if err != nil {
		return nil, err
	}

	refreshToken, err := s.signRefreshToken(userID, time.Now().UTC().Add(refreshTokenTTL))
	if err != nil {
		return nil, err
	}

	s.store.refreshByTokenHash[hexSHA256(refreshToken)] = &RefreshSession{
		TokenHash: hexSHA256(refreshToken),
		UserID:    userID,
		ExpiresAt: time.Now().UTC().Add(refreshTokenTTL),
	}

	return &tokenPair{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
	}, nil
}

func (s *Server) withAuth(next func(http.ResponseWriter, *http.Request, *User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
			writeError(w, http.StatusUnauthorized, "missing_bearer_token")
			return
		}

		token := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
		userID, err := s.verifyAccessToken(token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "invalid_access_token")
			return
		}

		s.store.mu.RLock()
		user, ok := s.store.usersByID[userID]
		s.store.mu.RUnlock()
		if !ok {
			writeError(w, http.StatusUnauthorized, "invalid_access_token")
			return
		}
		next(w, r, user)
	}
}

func withJSONContentType(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		next.ServeHTTP(w, r)
	})
}

func withCORS(next http.Handler) http.Handler {
	allowed := map[string]struct{}{
		"http://127.0.0.1:5173": {},
		"http://localhost:5173": {},
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if _, ok := allowed[origin]; ok {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func decodeJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func normalizeNickname(n string) string {
	return strings.ToLower(strings.TrimSpace(n))
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

func validatePassword(p string) error {
	if len(p) < passwordMinLen {
		return errors.New("weak_password")
	}
	return nil
}

func hashPassword(password string) (saltHex string, hashHex string, err error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", "", err
	}
	sum := derivePasswordHash(password, salt)
	return hex.EncodeToString(salt), hex.EncodeToString(sum), nil
}

func verifyPassword(password, saltHex, hashHex string) bool {
	salt, err := hex.DecodeString(saltHex)
	if err != nil {
		return false
	}
	expected, err := hex.DecodeString(hashHex)
	if err != nil {
		return false
	}
	actual := derivePasswordHash(password, salt)
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

func derivePasswordHash(password string, salt []byte) []byte {
	// Lightweight iterative SHA-256 KDF without external dependencies.
	d := append([]byte(password), salt...)
	sum := sha256.Sum256(d)
	out := sum[:]
	for i := 0; i < 120000; i++ {
		nextInput := append(out, salt...)
		next := sha256.Sum256(nextInput)
		out = next[:]
	}
	return out
}

func (s *Server) signAccessToken(userID string, exp time.Time) (string, error) {
	return signToken("acc", userID, exp, s.accessKey)
}

func (s *Server) verifyAccessToken(token string) (string, error) {
	return verifyToken("acc", token, s.accessKey)
}

func (s *Server) signRefreshToken(userID string, exp time.Time) (string, error) {
	return signToken("ref", userID, exp, s.refreshKey)
}

func (s *Server) verifyRefreshToken(token string) (string, error) {
	return verifyToken("ref", token, s.refreshKey)
}

func signToken(kind, userID string, exp time.Time, key []byte) (string, error) {
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	payload := fmt.Sprintf("%s|%s|%d|%s", kind, userID, exp.Unix(), hex.EncodeToString(nonce))
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(payload))
	signature := hex.EncodeToString(mac.Sum(nil))
	raw := payload + "|" + signature
	return base64.RawURLEncoding.EncodeToString([]byte(raw)), nil
}

func verifyToken(expectedKind, token string, key []byte) (string, error) {
	rawBytes, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return "", err
	}
	parts := strings.Split(string(rawBytes), "|")
	if len(parts) != 5 {
		return "", errors.New("bad_token")
	}
	kind, userID, expRaw, nonceHex, sigHex := parts[0], parts[1], parts[2], parts[3], parts[4]
	if kind != expectedKind || userID == "" || nonceHex == "" {
		return "", errors.New("bad_token")
	}

	payload := strings.Join(parts[:4], "|")
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(payload))
	expectedSig := hex.EncodeToString(mac.Sum(nil))
	if subtle.ConstantTimeCompare([]byte(expectedSig), []byte(sigHex)) != 1 {
		return "", errors.New("bad_signature")
	}

	expUnix, err := parseInt64(expRaw)
	if err != nil {
		return "", err
	}
	if time.Now().UTC().After(time.Unix(expUnix, 0).UTC()) {
		return "", errors.New("expired")
	}

	return userID, nil
}

func parseInt64(v string) (int64, error) {
	var out int64
	_, err := fmt.Sscanf(v, "%d", &out)
	return out, err
}

func hexSHA256(v string) string {
	sum := sha256.Sum256([]byte(v))
	return hex.EncodeToString(sum[:])
}
