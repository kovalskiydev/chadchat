package main

import (
	"bytes"
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
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"
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
	PasswordSalt       string    `json:"-"`
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
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /auth/anonymous", s.handleAnonymous)
	mux.HandleFunc("POST /auth/register", s.handleRegister)
	mux.HandleFunc("POST /auth/login", s.handleLogin)
	mux.HandleFunc("POST /auth/upgrade", s.withAuth(s.handleUpgrade))
	mux.HandleFunc("POST /auth/refresh", s.handleRefresh)
	mux.HandleFunc("POST /auth/logout", s.handleLogout)
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

	salt, hash, _ := hashPassword(req.Password)
	now := time.Now().UTC()
	user := &User{ID: s.store.nextUserID(), Nickname: nick, PasswordSalt: salt, PasswordHash: hash, Type: userTypeRegistered, VerificationStatus: "passed", CreatedAt: now, UpdatedAt: now}

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
	if req.VerificationToken == "" {
		writeErr(w, 400, "verification_required")
		return
	}
	if err := s.consumeVerificationToken(req.VerificationToken); err != nil {
		writeErr(w, 401, "invalid_verification_token")
		return
	}
	salt, hash, _ := hashPassword(req.Password)

	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	if _, ok := s.store.registeredByNick[nick]; ok {
		writeErr(w, 409, "nickname_taken")
		return
	}
	user.Nickname, user.PasswordSalt, user.PasswordHash = nick, salt, hash
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
	if !verifyPassword(req.Password, user.PasswordSalt, user.PasswordHash) {
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
	resp, err := http.Post(s.verificationBaseURL+"/verification/consume", "application/json", bytes.NewReader(payload))
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
func hashPassword(password string) (string, string, error) {
	s := make([]byte, 16)
	if _, err := rand.Read(s); err != nil {
		return "", "", err
	}
	h := derivePasswordHash(password, s)
	return hex.EncodeToString(s), hex.EncodeToString(h), nil
}
func verifyPassword(password, saltHex, hashHex string) bool {
	s, err := hex.DecodeString(saltHex)
	if err != nil {
		return false
	}
	e, err := hex.DecodeString(hashHex)
	if err != nil {
		return false
	}
	a := derivePasswordHash(password, s)
	return subtle.ConstantTimeCompare(a, e) == 1
}
func derivePasswordHash(password string, salt []byte) []byte {
	d := append([]byte(password), salt...)
	sum := sha256.Sum256(d)
	out := sum[:]
	for i := 0; i < 120000; i++ {
		next := sha256.Sum256(append(out, salt...))
		out = next[:]
	}
	return out
}
func signToken(kind, uid string, exp time.Time, key []byte) (string, error) {
	n := make([]byte, 16)
	if _, err := rand.Read(n); err != nil {
		return "", err
	}
	payload := fmt.Sprintf("%s|%s|%d|%s", kind, uid, exp.Unix(), hex.EncodeToString(n))
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(payload))
	sig := hex.EncodeToString(mac.Sum(nil))
	return base64.RawURLEncoding.EncodeToString([]byte(payload + "|" + sig)), nil
}
func verifyToken(kind, token string, key []byte) (string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return "", err
	}
	parts := strings.Split(string(raw), "|")
	if len(parts) != 5 || parts[0] != kind || parts[1] == "" {
		return "", errors.New("bad_token")
	}
	payload := strings.Join(parts[:4], "|")
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(payload))
	expSig := hex.EncodeToString(mac.Sum(nil))
	if subtle.ConstantTimeCompare([]byte(expSig), []byte(parts[4])) != 1 {
		return "", errors.New("bad_sig")
	}
	var exp int64
	if _, err := fmt.Sscanf(parts[2], "%d", &exp); err != nil {
		return "", err
	}
	if time.Now().UTC().After(time.Unix(exp, 0).UTC()) {
		return "", errors.New("expired")
	}
	return parts[1], nil
}
func hexSHA256(v string) string { s := sha256.Sum256([]byte(v)); return hex.EncodeToString(s[:]) }

func generateAnonymousNickname(userID string) string {
	numeric := strings.TrimPrefix(userID, "u_")
	return fmt.Sprintf("anonymys #%s", numeric)
}
