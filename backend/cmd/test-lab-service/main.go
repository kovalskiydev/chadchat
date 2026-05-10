package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type Server struct {
	authServiceURL string
	mlServiceURL   string
	store          *Store
}

type Store struct {
	mu    sync.RWMutex
	rooms map[string]*Room
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

const testLabSessionDuration = 10 * time.Second

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
	s := &Server{
		authServiceURL: envOr("AUTH_SERVICE_URL", "http://localhost:8081"),
		mlServiceURL:   envOr("ML_SERVICE_URL", "http://localhost:8090"),
		store:          &Store{rooms: map[string]*Room{}},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /test-lab/rooms", s.withAuth(s.handleCreateRoom))
	mux.HandleFunc("GET /test-lab/rooms/{roomID}", s.withAuth(s.handleGetRoom))
	mux.HandleFunc("POST /test-lab/rooms/{roomID}/sessions/start", s.withAuth(s.handleStartSession))
	mux.HandleFunc("POST /test-lab/rooms/{roomID}/sessions/{sessionID}/scan", s.withAuth(s.handleScanFrame))
	mux.HandleFunc("GET /test-lab/rooms/{roomID}/sessions/{sessionID}", s.withAuth(s.handleGetSession))

	addr := ":" + envOr("PORT", "8083")
	log.Printf("test-lab-service on %s", addr)
	log.Fatal(http.ListenAndServe(addr, withJSON(mux)))
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

	s.store.mu.Lock()
	s.store.rooms[room.ID] = room
	s.store.mu.Unlock()

	writeJSON(w, http.StatusOK, createRoomResponse{Room: room})
}

func (s *Server) handleGetRoom(w http.ResponseWriter, r *http.Request, userID string) {
	roomID := r.PathValue("roomID")
	if roomID == "" {
		writeErr(w, http.StatusBadRequest, "missing_room_id")
		return
	}

	s.store.mu.RLock()
	room, ok := s.store.rooms[roomID]
	s.store.mu.RUnlock()
	if !ok {
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
	if roomID == "" {
		writeErr(w, http.StatusBadRequest, "missing_room_id")
		return
	}

	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	room, ok := s.store.rooms[roomID]
	if !ok {
		writeErr(w, http.StatusNotFound, "room_not_found")
		return
	}
	if room.OwnerID != userID {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}

	session := &LabSession{
		ID:        "sess_" + randHex(8),
		StartedAt: time.Now().UTC(),
		EndsAt:    time.Now().UTC().Add(testLabSessionDuration),
		Samples:   []ScoreRecord{},
	}
	room.Sessions = append(room.Sessions, session)
	writeJSON(w, http.StatusOK, map[string]any{
		"room_id":      room.ID,
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

	s.store.mu.Lock()
	room, ok := s.store.rooms[roomID]
	if !ok {
		s.store.mu.Unlock()
		writeErr(w, http.StatusNotFound, "room_not_found")
		return
	}
	if room.OwnerID != userID {
		s.store.mu.Unlock()
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}

	session := findSession(room, sessionID)
	if session == nil {
		s.store.mu.Unlock()
		writeErr(w, http.StatusNotFound, "session_not_found")
		return
	}

	now := time.Now().UTC()
	if session.FinishedAt == nil && !now.Before(session.EndsAt) {
		finishSession(session, now)
	}
	if session.FinishedAt != nil {
		resp := buildSessionState(room.ID, session, now)
		s.store.mu.Unlock()
		writeJSON(w, http.StatusOK, resp)
		return
	}
	s.store.mu.Unlock()

	score, err := s.predictScore(req.ImageBase64)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "ml_service_unavailable")
		return
	}

	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	room = s.store.rooms[roomID]
	if room == nil || room.OwnerID != userID {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	session = findSession(room, sessionID)
	if session == nil {
		writeErr(w, http.StatusNotFound, "session_not_found")
		return
	}

	now = time.Now().UTC()
	if session.FinishedAt == nil && now.Before(session.EndsAt) {
		session.Samples = append(session.Samples, ScoreRecord{Score: score, CreatedAt: now})
	}
	if session.FinishedAt == nil && !now.Before(session.EndsAt) {
		finishSession(session, now)
	}

	writeJSON(w, http.StatusOK, buildSessionState(room.ID, session, now))
}

func (s *Server) handleGetSession(w http.ResponseWriter, r *http.Request, userID string) {
	roomID := r.PathValue("roomID")
	sessionID := r.PathValue("sessionID")
	if roomID == "" || sessionID == "" {
		writeErr(w, http.StatusBadRequest, "missing_room_or_session_id")
		return
	}

	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	room, ok := s.store.rooms[roomID]
	if !ok {
		writeErr(w, http.StatusNotFound, "room_not_found")
		return
	}
	if room.OwnerID != userID {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	session := findSession(room, sessionID)
	if session == nil {
		writeErr(w, http.StatusNotFound, "session_not_found")
		return
	}
	now := time.Now().UTC()
	if session.FinishedAt == nil && !now.Before(session.EndsAt) {
		finishSession(session, now)
	}
	writeJSON(w, http.StatusOK, buildSessionState(room.ID, session, now))
}

func findSession(room *Room, sessionID string) *LabSession {
	for _, s := range room.Sessions {
		if s.ID == sessionID {
			return s
		}
	}
	return nil
}

func finishSession(session *LabSession, now time.Time) {
	if session.FinishedAt != nil {
		return
	}
	session.FinishedAt = &now
	avg := average(session.Samples)
	session.FinalAverage = &avg
}

func buildSessionState(roomID string, session *LabSession, now time.Time) sessionStateResponse {
	isFinished := session.FinishedAt != nil
	secondsLeft := int64(0)
	if !isFinished {
		secondsLeft = int64(time.Until(session.EndsAt).Seconds())
		if secondsLeft < 0 {
			secondsLeft = 0
		}
	}
	var lastScore *float64
	var latestAt *time.Time
	if n := len(session.Samples); n > 0 {
		v := session.Samples[n-1].Score
		t := session.Samples[n-1].CreatedAt
		lastScore = &v
		latestAt = &t
	}
	running := average(session.Samples)
	return sessionStateResponse{
		RoomID:         roomID,
		SessionID:      session.ID,
		IsFinished:     isFinished,
		SecondsLeft:    secondsLeft,
		SamplesCount:   len(session.Samples),
		LastScore:      lastScore,
		RunningAverage: &running,
		FinalAverage:   session.FinalAverage,
		LatestSampleAt: latestAt,
		StartedAt:      session.StartedAt,
		EndsAt:         session.EndsAt,
		FinishedAt:     session.FinishedAt,
	}
}

func average(samples []ScoreRecord) float64 {
	if len(samples) == 0 {
		return 0
	}
	sum := 0.0
	for _, s := range samples {
		sum += s.Score
	}
	return sum / float64(len(samples))
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

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
