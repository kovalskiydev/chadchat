package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"backend/internal/mysqlutil"
	"backend/internal/rateutil"
)

type challengeSession struct {
	ID          string
	BlinkCount  int
	TurnLeft    int
	TurnRight   int
	ExpiresAt   time.Time
	CompletedAt sql.NullTime
}

type store struct {
	db             *sql.DB
	internalSecret string
	limiter        *rateutil.Limiter
}

type submitRequest struct {
	VerificationSessionID string `json:"verification_session_id"`
	DetectedBlinkCount    int    `json:"detected_blink_count"`
	DetectedTurnLeft      int    `json:"detected_turn_left"`
	DetectedTurnRight     int    `json:"detected_turn_right"`
}

type consumeRequest struct {
	VerificationToken string `json:"verification_token"`
}

func main() {
	db, err := mysqlutil.OpenFromEnv()
	if err != nil {
		log.Fatalf("open mysql: %v", err)
	}

	if err := mysqlutil.ExecStatements(db, verificationSchema()); err != nil {
		log.Fatalf("verification schema: %v", err)
	}

	s := &store{
		db:             db,
		internalSecret: envOr("VERIFICATION_INTERNAL_SECRET", "dev-internal-secret-change-me"),
		limiter:        rateutil.NewLimiter(),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("POST /verification/start", s.withRateLimit(10, time.Minute, s.handleStart))
	mux.HandleFunc("POST /verification/submit", s.withRateLimit(20, time.Minute, s.handleSubmit))
	mux.HandleFunc("POST /verification/consume", s.handleConsume)

	addr := ":" + envOr("PORT", "8082")
	log.Printf("verification-service on %s", addr)
	log.Fatal(http.ListenAndServe(addr, withJSON(mux)))
}

func (s *store) handleHealth(w http.ResponseWriter, _ *http.Request) {
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

func verificationSchema() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS verification_sessions (
			id VARCHAR(64) NOT NULL PRIMARY KEY,
			blink_count INT NOT NULL,
			turn_left INT NOT NULL,
			turn_right INT NOT NULL,
			expires_at DATETIME(6) NOT NULL,
			completed_at DATETIME(6) NULL,
			created_at DATETIME(6) NOT NULL
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS verification_tokens (
			token VARCHAR(128) NOT NULL PRIMARY KEY,
			expires_at DATETIME(6) NOT NULL,
			used_at DATETIME(6) NULL,
			created_at DATETIME(6) NOT NULL
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
	}
}

func (s *store) handleStart(w http.ResponseWriter, _ *http.Request) {
	sessionID := randHex(12)
	now := time.Now().UTC()
	session := challengeSession{
		ID:         sessionID,
		BlinkCount: randInt(1, 4),
		TurnLeft:   randInt(1, 3),
		TurnRight:  randInt(1, 3),
		ExpiresAt:  now.Add(90 * time.Second),
	}

	_, err := s.db.Exec(
		`INSERT INTO verification_sessions (id, blink_count, turn_left, turn_right, expires_at, completed_at, created_at)
		 VALUES (?, ?, ?, ?, ?, NULL, ?)`,
		session.ID, session.BlinkCount, session.TurnLeft, session.TurnRight, session.ExpiresAt, now,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"verification_session_id": session.ID,
		"blink_count":             session.BlinkCount,
		"turn_left":               session.TurnLeft,
		"turn_right":              session.TurnRight,
		"expires_in_sec":          90,
	})
}

func (s *store) handleSubmit(w http.ResponseWriter, r *http.Request) {
	var req submitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}

	var session challengeSession
	err := s.db.QueryRow(
		`SELECT id, blink_count, turn_left, turn_right, expires_at, completed_at
		 FROM verification_sessions WHERE id = ?`,
		req.VerificationSessionID,
	).Scan(&session.ID, &session.BlinkCount, &session.TurnLeft, &session.TurnRight, &session.ExpiresAt, &session.CompletedAt)
	if err != nil || session.ExpiresAt.Before(time.Now().UTC()) {
		writeErr(w, http.StatusBadRequest, "invalid_or_expired_session")
		return
	}
	if session.CompletedAt.Valid {
		writeErr(w, http.StatusBadRequest, "session_already_completed")
		return
	}

	passed := req.DetectedBlinkCount == session.BlinkCount &&
		req.DetectedTurnLeft == session.TurnLeft &&
		req.DetectedTurnRight == session.TurnRight
	if !passed {
		writeJSON(w, http.StatusOK, map[string]any{"passed": false})
		return
	}

	now := time.Now().UTC()
	if _, err := s.db.Exec(`UPDATE verification_sessions SET completed_at = ? WHERE id = ?`, now, session.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	token := randHex(24)
	if _, err := s.db.Exec(
		`INSERT INTO verification_tokens (token, expires_at, used_at, created_at)
		 VALUES (?, ?, NULL, ?)`,
		token, now.Add(5*time.Minute), now,
	); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"passed":             true,
		"verification_token": token,
		"expires_in_sec":     300,
	})
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

	var expiresAt time.Time
	var usedAt sql.NullTime
	err := s.db.QueryRow(
		`SELECT expires_at, used_at FROM verification_tokens WHERE token = ?`,
		req.VerificationToken,
	).Scan(&expiresAt, &usedAt)
	if err != nil || expiresAt.Before(time.Now().UTC()) || usedAt.Valid {
		writeErr(w, http.StatusUnauthorized, "invalid_verification_token")
		return
	}

	now := time.Now().UTC()
	if _, err := s.db.Exec(`UPDATE verification_tokens SET used_at = ? WHERE token = ? AND used_at IS NULL`, now, req.VerificationToken); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
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
	buf := make([]byte, n)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}

func randInt(min, max int) int {
	if max <= min {
		return min
	}
	buf := make([]byte, 1)
	_, _ = rand.Read(buf)
	return min + int(buf[0])%(max-min+1)
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
