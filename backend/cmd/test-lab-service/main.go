package main

import (
	"bytes"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"backend/internal/mysqlutil"
	"backend/internal/rateutil"
)

type Server struct {
	authServiceURL string
	mlServiceURL   string
	db             *sql.DB
	limiter        *rateutil.Limiter
}

type Room struct {
	ID        string        `json:"id"`
	Mode      string        `json:"mode"`
	OwnerID   string        `json:"owner_id"`
	CreatedAt time.Time     `json:"created_at"`
	Sessions  []*LabSession `json:"sessions"`
}

type ScoreRecord struct {
	Score     float64   `json:"score"`
	CreatedAt time.Time `json:"created_at"`
}

type LabSession struct {
	ID           string        `json:"id"`
	RoomID       string        `json:"-"`
	StartedAt    time.Time     `json:"started_at"`
	EndsAt       time.Time     `json:"ends_at"`
	FinishedAt   *time.Time    `json:"finished_at,omitempty"`
	Samples      []ScoreRecord `json:"samples"`
	FinalAverage *float64      `json:"final_average,omitempty"`
}

type createRoomResponse struct {
	Room *Room `json:"room"`
}

type evaluateRequest struct {
	ImageBase64 string `json:"image_base64"`
}

type mlPredictResponse struct {
	Score float64 `json:"score"`
}

const (
	testLabSessionDuration = 10 * time.Second
	scanRateLimitPerMinute = 210
)

type sessionStateResponse struct {
	RoomID         string     `json:"room_id"`
	SessionID      string     `json:"session_id"`
	IsFinished     bool       `json:"is_finished"`
	SecondsLeft    int64      `json:"seconds_left"`
	SamplesCount   int        `json:"samples_count"`
	LastScore      *float64   `json:"last_score,omitempty"`
	RunningAverage *float64   `json:"running_average,omitempty"`
	FinalAverage   *float64   `json:"final_average,omitempty"`
	LatestSampleAt *time.Time `json:"latest_sample_at,omitempty"`
	StartedAt      time.Time  `json:"started_at"`
	EndsAt         time.Time  `json:"ends_at"`
	FinishedAt     *time.Time `json:"finished_at,omitempty"`
}

type meResponse struct {
	User struct {
		ID string `json:"id"`
	} `json:"user"`
}

func main() {
	db, err := mysqlutil.OpenFromEnv()
	if err != nil {
		log.Fatalf("open mysql: %v", err)
	}
	if err := mysqlutil.ExecStatements(db, testLabSchema()); err != nil {
		log.Fatalf("test lab schema: %v", err)
	}

	s := &Server{
		authServiceURL: envOr("AUTH_SERVICE_URL", "http://localhost:8081"),
		mlServiceURL:   envOr("ML_SERVICE_URL", "http://localhost:8090"),
		db:             db,
		limiter:        rateutil.NewLimiter(),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /test-lab/rooms", s.withAuth(s.handleCreateRoom))
	mux.HandleFunc("GET /test-lab/rooms/{roomID}", s.withAuth(s.handleGetRoom))
	mux.HandleFunc("POST /test-lab/rooms/{roomID}/sessions/start", s.withAuth(s.handleStartSession))
	mux.HandleFunc("POST /test-lab/rooms/{roomID}/sessions/{sessionID}/scan", s.withRateLimit(scanRateLimitPerMinute, time.Minute, s.withAuth(s.handleScanFrame)))
	mux.HandleFunc("GET /test-lab/rooms/{roomID}/sessions/{sessionID}", s.withAuth(s.handleGetSession))

	addr := ":" + envOr("PORT", "8083")
	log.Printf("test-lab-service on %s", addr)
	log.Fatal(http.ListenAndServe(addr, withJSON(mux)))
}

func testLabSchema() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS test_lab_rooms (
			id VARCHAR(64) NOT NULL PRIMARY KEY,
			owner_id VARCHAR(64) NOT NULL,
			mode VARCHAR(32) NOT NULL,
			created_at DATETIME(6) NOT NULL,
			INDEX idx_test_lab_rooms_owner_id (owner_id)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS test_lab_sessions (
			id VARCHAR(64) NOT NULL PRIMARY KEY,
			room_id VARCHAR(64) NOT NULL,
			started_at DATETIME(6) NOT NULL,
			ends_at DATETIME(6) NOT NULL,
			finished_at DATETIME(6) NULL,
			final_average DOUBLE NULL,
			INDEX idx_test_lab_sessions_room_id (room_id)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS test_lab_samples (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
			session_id VARCHAR(64) NOT NULL,
			score DOUBLE NOT NULL,
			created_at DATETIME(6) NOT NULL,
			INDEX idx_test_lab_samples_session_id (session_id, created_at)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
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

func (s *Server) withAuth(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			writeErr(w, http.StatusUnauthorized, "missing_bearer_token")
			return
		}
		userID, err := s.resolveUserID(authHeader)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "invalid_access_token")
			return
		}
		next(w, r, userID)
	}
}

func (s *Server) resolveUserID(authHeader string) (string, error) {
	req, err := http.NewRequest(http.MethodGet, s.authServiceURL+"/me", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", authHeader)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", errors.New("unauthorized")
	}

	var me meResponse
	if err := json.NewDecoder(resp.Body).Decode(&me); err != nil {
		return "", err
	}
	if me.User.ID == "" {
		return "", errors.New("empty_user")
	}
	return me.User.ID, nil
}

func (s *Server) handleCreateRoom(w http.ResponseWriter, _ *http.Request, userID string) {
	room := &Room{
		ID:        "tl_" + randHex(8),
		Mode:      "test_lab",
		OwnerID:   userID,
		CreatedAt: time.Now().UTC(),
		Sessions:  []*LabSession{},
	}

	if _, err := s.db.Exec(
		`INSERT INTO test_lab_rooms (id, owner_id, mode, created_at) VALUES (?, ?, ?, ?)`,
		room.ID, room.OwnerID, room.Mode, room.CreatedAt,
	); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	writeJSON(w, http.StatusOK, createRoomResponse{Room: room})
}

func (s *Server) handleGetRoom(w http.ResponseWriter, r *http.Request, userID string) {
	roomID := r.PathValue("roomID")
	room, err := s.loadRoom(roomID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "room_not_found")
		return
	}
	if room.OwnerID != userID {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	writeJSON(w, http.StatusOK, map[string]*Room{"room": room})
}

func (s *Server) handleStartSession(w http.ResponseWriter, r *http.Request, userID string) {
	roomID := r.PathValue("roomID")
	room, err := s.loadRoom(roomID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "room_not_found")
		return
	}
	if room.OwnerID != userID {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}

	now := time.Now().UTC()
	session := &LabSession{
		ID:        "sess_" + randHex(8),
		StartedAt: now,
		EndsAt:    now.Add(testLabSessionDuration),
		Samples:   []ScoreRecord{},
	}
	if _, err := s.db.Exec(
		`INSERT INTO test_lab_sessions (id, room_id, started_at, ends_at, finished_at, final_average)
		 VALUES (?, ?, ?, ?, NULL, NULL)`,
		session.ID, roomID, session.StartedAt, session.EndsAt,
	); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"room_id":      roomID,
		"session_id":   session.ID,
		"duration_sec": int(testLabSessionDuration / time.Second),
		"started_at":   session.StartedAt,
		"ends_at":      session.EndsAt,
	})
}

func (s *Server) handleScanFrame(w http.ResponseWriter, r *http.Request, userID string) {
	roomID := r.PathValue("roomID")
	sessionID := r.PathValue("sessionID")
	if roomID == "" || sessionID == "" {
		writeErr(w, http.StatusBadRequest, "missing_room_or_session_id")
		return
	}

	var req evaluateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if strings.TrimSpace(req.ImageBase64) == "" {
		writeErr(w, http.StatusBadRequest, "missing_image_base64")
		return
	}

	room, err := s.loadRoom(roomID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "room_not_found")
		return
	}
	if room.OwnerID != userID {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}

	session, err := s.loadSession(sessionID)
	if err != nil || sessionRoomID(session) != roomID {
		writeErr(w, http.StatusNotFound, "session_not_found")
		return
	}

	now := time.Now().UTC()
	if session.FinishedAt == nil && !now.Before(session.EndsAt) {
		if err := s.finishSession(sessionID, now); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		state, err := s.buildSessionState(roomID, sessionID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		writeJSON(w, http.StatusOK, state)
		return
	}
	if session.FinishedAt != nil {
		state, err := s.buildSessionState(roomID, sessionID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		writeJSON(w, http.StatusOK, state)
		return
	}

	score, err := s.predictScore(req.ImageBase64)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "ml_service_unavailable")
		return
	}

	if _, err := s.db.Exec(
		`INSERT INTO test_lab_samples (session_id, score, created_at) VALUES (?, ?, ?)`,
		sessionID, score, time.Now().UTC(),
	); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	if time.Now().UTC().After(session.EndsAt) {
		if err := s.finishSession(sessionID, time.Now().UTC()); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
	}

	state, err := s.buildSessionState(roomID, sessionID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) handleGetSession(w http.ResponseWriter, r *http.Request, userID string) {
	roomID := r.PathValue("roomID")
	sessionID := r.PathValue("sessionID")
	if roomID == "" || sessionID == "" {
		writeErr(w, http.StatusBadRequest, "missing_room_or_session_id")
		return
	}

	room, err := s.loadRoom(roomID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "room_not_found")
		return
	}
	if room.OwnerID != userID {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}

	session, err := s.loadSession(sessionID)
	if err != nil || sessionRoomID(session) != roomID {
		writeErr(w, http.StatusNotFound, "session_not_found")
		return
	}
	if session.FinishedAt == nil && !time.Now().UTC().Before(session.EndsAt) {
		if err := s.finishSession(sessionID, time.Now().UTC()); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
	}

	state, err := s.buildSessionState(roomID, sessionID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) loadRoom(roomID string) (*Room, error) {
	var room Room
	err := s.db.QueryRow(
		`SELECT id, owner_id, mode, created_at FROM test_lab_rooms WHERE id = ?`,
		roomID,
	).Scan(&room.ID, &room.OwnerID, &room.Mode, &room.CreatedAt)
	if err != nil {
		return nil, err
	}

	rows, err := s.db.Query(
		`SELECT id, started_at, ends_at, finished_at, final_average
		 FROM test_lab_sessions WHERE room_id = ? ORDER BY started_at ASC`,
		roomID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	room.Sessions = []*LabSession{}
	for rows.Next() {
		var session LabSession
		var finishedAt sql.NullTime
		var finalAvg sql.NullFloat64
		if err := rows.Scan(&session.ID, &session.StartedAt, &session.EndsAt, &finishedAt, &finalAvg); err != nil {
			return nil, err
		}
		if finishedAt.Valid {
			t := finishedAt.Time
			session.FinishedAt = &t
		}
		if finalAvg.Valid {
			v := finalAvg.Float64
			session.FinalAverage = &v
		}
		room.Sessions = append(room.Sessions, &session)
	}
	return &room, rows.Err()
}

func (s *Server) loadSession(sessionID string) (*LabSession, error) {
	var session LabSession
	var roomID string
	var finishedAt sql.NullTime
	var finalAvg sql.NullFloat64
	err := s.db.QueryRow(
		`SELECT id, room_id, started_at, ends_at, finished_at, final_average
		 FROM test_lab_sessions WHERE id = ?`,
		sessionID,
	).Scan(&session.ID, &roomID, &session.StartedAt, &session.EndsAt, &finishedAt, &finalAvg)
	if err != nil {
		return nil, err
	}
	session.RoomID = roomID
	session.Samples = []ScoreRecord{}
	if finishedAt.Valid {
		t := finishedAt.Time
		session.FinishedAt = &t
	}
	if finalAvg.Valid {
		v := finalAvg.Float64
		session.FinalAverage = &v
	}
	return &session, nil
}

func sessionRoomID(session *LabSession) string {
	return session.RoomID
}

func (s *Server) finishSession(sessionID string, now time.Time) error {
	stats, err := s.sessionStats(sessionID)
	if err != nil {
		return err
	}
	finalAverage := 0.0
	if stats.SamplesCount > 0 {
		finalAverage = stats.RunningAverage
	}
	_, err = s.db.Exec(
		`UPDATE test_lab_sessions
		 SET finished_at = COALESCE(finished_at, ?), final_average = ?
		 WHERE id = ?`,
		now, finalAverage, sessionID,
	)
	return err
}

func (s *Server) buildSessionState(roomID, sessionID string) (sessionStateResponse, error) {
	var startedAt, endsAt time.Time
	var finishedAt sql.NullTime
	var finalAvg sql.NullFloat64
	err := s.db.QueryRow(
		`SELECT started_at, ends_at, finished_at, final_average
		 FROM test_lab_sessions WHERE id = ?`,
		sessionID,
	).Scan(&startedAt, &endsAt, &finishedAt, &finalAvg)
	if err != nil {
		return sessionStateResponse{}, err
	}

	stats, err := s.sessionStats(sessionID)
	if err != nil {
		return sessionStateResponse{}, err
	}

	resp := sessionStateResponse{
		RoomID:         roomID,
		SessionID:      sessionID,
		IsFinished:     finishedAt.Valid,
		SecondsLeft:    secondsLeft(endsAt, finishedAt.Valid),
		SamplesCount:   stats.SamplesCount,
		RunningAverage: &stats.RunningAverage,
		StartedAt:      startedAt,
		EndsAt:         endsAt,
	}
	if stats.LastScoreValid {
		resp.LastScore = &stats.LastScore
		resp.LatestSampleAt = &stats.LastSampleAt
	}
	if finishedAt.Valid {
		t := finishedAt.Time
		resp.FinishedAt = &t
	}
	if finalAvg.Valid {
		v := finalAvg.Float64
		resp.FinalAverage = &v
	}
	return resp, nil
}

type stats struct {
	SamplesCount   int
	RunningAverage float64
	LastScore      float64
	LastScoreValid bool
	LastSampleAt   time.Time
}

func (s *Server) sessionStats(sessionID string) (stats, error) {
	var out stats
	err := s.db.QueryRow(
		`SELECT COUNT(*), COALESCE(AVG(score), 0)
		 FROM test_lab_samples WHERE session_id = ?`,
		sessionID,
	).Scan(&out.SamplesCount, &out.RunningAverage)
	if err != nil {
		return out, err
	}

	err = s.db.QueryRow(
		`SELECT score, created_at
		 FROM test_lab_samples
		 WHERE session_id = ?
		 ORDER BY created_at DESC
		 LIMIT 1`,
		sessionID,
	).Scan(&out.LastScore, &out.LastSampleAt)
	if err == nil {
		out.LastScoreValid = true
		return out, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return out, nil
	}
	return out, err
}

func secondsLeft(endsAt time.Time, finished bool) int64 {
	if finished {
		return 0
	}
	delta := time.Until(endsAt)
	if delta <= 0 {
		return 0
	}
	return int64(delta.Seconds())
}

func (s *Server) predictScore(imageBase64 string) (float64, error) {
	payload, _ := json.Marshal(map[string]string{"image_base64": imageBase64})
	resp, err := http.Post(s.mlServiceURL+"/predict", "application/json", bytes.NewReader(payload))
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return 0, fmt.Errorf("predict failed: %s", string(body))
	}

	var out mlPredictResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return 0, err
	}
	return out.Score, nil
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

func randHex(n int) string {
	buf := make([]byte, n)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}
