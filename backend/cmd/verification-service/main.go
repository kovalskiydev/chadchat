package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"backend/internal/rateutil"
)

type challengeSession struct {
	ID          string
	BlinkCount  int
	TurnLeft    int
	TurnRight   int
	ExpiresAt   time.Time
	CompletedAt *time.Time
}

type verificationToken struct {
	Token     string
	ExpiresAt time.Time
	Used      bool
}

type store struct {
	mu             sync.Mutex
	sessions       map[string]*challengeSession
	tokens         map[string]*verificationToken
	internalSecret string
	limiter        *rateutil.Limiter
}

func main() {
	s := &store{
		sessions:       map[string]*challengeSession{},
		tokens:         map[string]*verificationToken{},
		internalSecret: envOr("VERIFICATION_INTERNAL_SECRET", "dev-internal-secret-change-me"),
		limiter:        rateutil.NewLimiter(),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /verification/start", s.withRateLimit(10, time.Minute, s.handleStart))
	mux.HandleFunc("POST /verification/submit", s.withRateLimit(20, time.Minute, s.handleSubmit))
	mux.HandleFunc("POST /verification/consume", s.handleConsume)

	addr := ":" + envOr("PORT", "8082")
	log.Printf("verification-service on %s", addr)
	log.Fatal(http.ListenAndServe(addr, withJSON(mux)))
}

func (s *store) handleStart(w http.ResponseWriter, _ *http.Request) {
	sessionID := randHex(12)
	challenge := &challengeSession{
		ID:         sessionID,
		BlinkCount: randInt(1, 4),
		TurnLeft:   randInt(1, 3),
		TurnRight:  randInt(1, 3),
		ExpiresAt:  time.Now().UTC().Add(90 * time.Second),
	}

	s.mu.Lock()
	s.sessions[sessionID] = challenge
	s.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"verification_session_id": sessionID,
		"blink_count":             challenge.BlinkCount,
		"turn_left":               challenge.TurnLeft,
		"turn_right":              challenge.TurnRight,
		"expires_in_sec":          90,
	})
}

type submitRequest struct {
	VerificationSessionID string `json:"verification_session_id"`
	DetectedBlinkCount    int    `json:"detected_blink_count"`
	DetectedTurnLeft      int    `json:"detected_turn_left"`
	DetectedTurnRight     int    `json:"detected_turn_right"`
}

func (s *store) handleSubmit(w http.ResponseWriter, r *http.Request) {
	var req submitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	session, ok := s.sessions[req.VerificationSessionID]
	if !ok || session.ExpiresAt.Before(time.Now().UTC()) {
		writeErr(w, http.StatusBadRequest, "invalid_or_expired_session")
		return
	}
	if session.CompletedAt != nil {
		writeErr(w, http.StatusBadRequest, "session_already_completed")
		return
	}

	passed := req.DetectedBlinkCount == session.BlinkCount && req.DetectedTurnLeft == session.TurnLeft && req.DetectedTurnRight == session.TurnRight
	if !passed {
		writeJSON(w, http.StatusOK, map[string]any{"passed": false})
		return
	}

	now := time.Now().UTC()
	session.CompletedAt = &now
	token := randHex(24)
	s.tokens[token] = &verificationToken{Token: token, ExpiresAt: now.Add(5 * time.Minute)}

	writeJSON(w, http.StatusOK, map[string]any{
		"passed":             true,
		"verification_token": token,
		"expires_in_sec":     300,
	})
}

type consumeRequest struct {
	VerificationToken string `json:"verification_token"`
}

func (s *store) handleConsume(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Internal-Verification-Secret") != s.internalSecret {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}

	var req consumeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	tok, ok := s.tokens[req.VerificationToken]
	if !ok || tok.ExpiresAt.Before(time.Now().UTC()) || tok.Used {
		writeErr(w, http.StatusUnauthorized, "invalid_verification_token")
		return
	}
	tok.Used = true
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *store) withRateLimit(limit int, window time.Duration, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := r.Method + ":" + r.URL.Path + ":" + rateutil.ClientKey(r)
		if !s.limiter.Allow(key, limit, window) {
			writeErr(w, http.StatusTooManyRequests, "rate_limited")
			return
		}
		next(w, r)
	}
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

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func randInt(min, max int) int {
	if max <= min {
		return min
	}
	b := make([]byte, 1)
	_, _ = rand.Read(b)
	return min + int(b[0])%(max-min+1)
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
