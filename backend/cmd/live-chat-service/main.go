package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"backend/internal/mysqlutil"
	"backend/internal/rateutil"
)

type Server struct {
	authServiceURL          string
	customizationServiceURL string
	customizationSecret     string
	db                      *sql.DB
	subsMu                  sync.RWMutex
	subscribers             map[string]chan []byte
	limiter                 *rateutil.Limiter
}

type ChatMessage struct {
	ID              string    `json:"id"`
	SenderID        string    `json:"sender_id"`
	SenderNickname  string    `json:"sender_nickname"`
	SenderRole      string    `json:"sender_role,omitempty"`
	SenderAvatarURL string    `json:"sender_avatar_url,omitempty"`
	Text            string    `json:"text"`
	ChatStyle       any       `json:"chat_style,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

type postMessageRequest struct {
	Text string `json:"text"`
}

type historyRequest struct {
	Limit int `json:"limit"`
}

type meResponse struct {
	User struct {
		ID       string `json:"id"`
		Nickname string `json:"nickname"`
		Role     string `json:"role"`
	} `json:"user"`
}

type authUser struct {
	ID       string
	Nickname string
	Role     string
}

type chatStyleInternalResponse struct {
	ChatStyle any `json:"chat_style"`
}

func main() {
	db, err := mysqlutil.OpenFromEnv()
	if err != nil {
		log.Fatalf("open mysql: %v", err)
	}
	if err := mysqlutil.ExecStatements(db, liveChatSchema()); err != nil {
		log.Fatalf("live chat schema: %v", err)
	}
	if err := ensureLiveChatColumns(db); err != nil {
		log.Fatalf("live chat schema: %v", err)
	}

	s := &Server{
		authServiceURL:          envOr("AUTH_SERVICE_URL", "http://localhost:8081"),
		customizationServiceURL: envOr("CUSTOMIZATION_SERVICE_URL", "http://localhost:8087"),
		customizationSecret:     envOr("CUSTOMIZATION_INTERNAL_SECRET", "dev-customization-secret-change-me"),
		db:                      db,
		subscribers:             map[string]chan []byte{},
		limiter:                 rateutil.NewLimiter(),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /live-chat/history", s.withAuth(s.handleHistory))
	mux.HandleFunc("POST /live-chat/history", s.withAuth(s.handleHistoryWithLimit))
	mux.HandleFunc("GET /live-chat/stream", s.withAuth(s.handleStream))
	mux.HandleFunc("POST /live-chat/messages", s.withRateLimit(30, time.Minute, s.withAuth(s.handlePostMessage)))

	addr := ":" + envOr("PORT", "8084")
	log.Printf("live-chat-service on %s", addr)
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

func liveChatSchema() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS live_chat_messages (
			id VARCHAR(64) NOT NULL PRIMARY KEY,
			sender_id VARCHAR(64) NOT NULL,
			sender_nickname VARCHAR(64) NOT NULL,
			text TEXT NOT NULL,
			chat_style_json JSON NULL,
			created_at DATETIME(6) NOT NULL,
			INDEX idx_live_chat_created_at (created_at)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
	}
}

func ensureLiveChatColumns(db *sql.DB) error {
	var count int
	if err := db.QueryRow(
		`SELECT COUNT(*)
		   FROM information_schema.COLUMNS
		  WHERE TABLE_SCHEMA = DATABASE()
		    AND TABLE_NAME = 'live_chat_messages'
		    AND COLUMN_NAME = 'chat_style_json'`,
	).Scan(&count); err != nil {
		return fmt.Errorf("check chat_style_json column: %w", err)
	}
	if count > 0 {
		return nil
	}
	if _, err := db.Exec(
		`ALTER TABLE live_chat_messages ADD COLUMN chat_style_json JSON NULL AFTER text`,
	); err != nil {
		return fmt.Errorf("add chat_style_json column: %w", err)
	}
	return nil
}

func (s *Server) withAuth(next func(http.ResponseWriter, *http.Request, authUser)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			writeErr(w, http.StatusUnauthorized, "missing_bearer_token")
			return
		}
		user, err := s.resolveUser(authHeader)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "invalid_access_token")
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

func (s *Server) resolveUser(authHeader string) (authUser, error) {
	req, err := http.NewRequest(http.MethodGet, s.authServiceURL+"/me", nil)
	if err != nil {
		return authUser{}, err
	}
	req.Header.Set("Authorization", authHeader)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return authUser{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return authUser{}, errors.New("unauthorized")
	}
	var me meResponse
	if err := json.NewDecoder(resp.Body).Decode(&me); err != nil {
		return authUser{}, err
	}
	if me.User.ID == "" {
		return authUser{}, errors.New("empty_user")
	}
	return authUser{ID: me.User.ID, Nickname: me.User.Nickname, Role: me.User.Role}, nil
}

func (s *Server) handleHistory(w http.ResponseWriter, _ *http.Request, _ authUser) {
	messages, err := s.fetchHistory(1000)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": messages})
}

func (s *Server) handleHistoryWithLimit(w http.ResponseWriter, r *http.Request, _ authUser) {
	var req historyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if req.Limit < 1 || req.Limit > 1000 {
		writeErr(w, http.StatusBadRequest, "invalid_limit")
		return
	}
	messages, err := s.fetchHistory(req.Limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": messages})
}

func (s *Server) handlePostMessage(w http.ResponseWriter, r *http.Request, user authUser) {
	var req postMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	text := strings.TrimSpace(req.Text)
	if text == "" {
		writeErr(w, http.StatusBadRequest, "empty_message")
		return
	}
	if len(text) > 2000 {
		writeErr(w, http.StatusBadRequest, "message_too_long")
		return
	}

	msg := ChatMessage{
		ID:             fmt.Sprintf("m_%d", time.Now().UnixNano()),
		SenderID:       user.ID,
		SenderNickname: user.Nickname,
		SenderRole:     user.Role,
		Text:           text,
		CreatedAt:      time.Now().UTC(),
	}
	msg.SenderAvatarURL = s.fetchAvatarURL(user.ID)
	style, err := s.fetchChatStyle(user.ID)
	if err == nil {
		msg.ChatStyle = style
	}
	var styleJSON []byte
	if msg.ChatStyle != nil {
		styleJSON, _ = json.Marshal(msg.ChatStyle)
	}
	if _, err := s.db.Exec(
		`INSERT INTO live_chat_messages (id, sender_id, sender_nickname, text, chat_style_json, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		msg.ID, msg.SenderID, msg.SenderNickname, msg.Text, nullableBytes(styleJSON), msg.CreatedAt,
	); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	payload, _ := json.Marshal(map[string]any{"type": "message", "message": msg})
	s.broadcast(payload)

	writeJSON(w, http.StatusOK, map[string]any{"message": msg})
}

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request, user authUser) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "stream_not_supported")
		return
	}

	history, err := s.fetchHistory(1000)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	subID := fmt.Sprintf("sub_%d", time.Now().UnixNano())
	sub := make(chan []byte, 64)
	s.subsMu.Lock()
	s.subscribers[subID] = sub
	s.subsMu.Unlock()

	defer func() {
		s.subsMu.Lock()
		delete(s.subscribers, subID)
		s.subsMu.Unlock()
		close(sub)
	}()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	joined, _ := json.Marshal(map[string]any{"type": "joined", "user_id": user.ID, "nickname": user.Nickname})
	_, _ = fmt.Fprintf(w, "data: %s\n\n", joined)
	for _, msg := range history {
		payload, _ := json.Marshal(map[string]any{"type": "history", "message": msg})
		_, _ = fmt.Fprintf(w, "data: %s\n\n", payload)
	}
	flusher.Flush()

	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			_, _ = fmt.Fprintf(w, ": ping\n\n")
			flusher.Flush()
		case payload := <-sub:
			_, _ = fmt.Fprintf(w, "data: %s\n\n", payload)
			flusher.Flush()
		}
	}
}

func (s *Server) fetchHistory(limit int) ([]ChatMessage, error) {
	rows, err := s.db.Query(
		`SELECT recent.id, recent.sender_id, recent.sender_nickname, COALESCE(u.role, 'user'), COALESCE(up.avatar_url, ''), recent.text, recent.chat_style_json, recent.created_at
		 FROM (
		 	SELECT id, sender_id, sender_nickname, text, chat_style_json, created_at
		 	FROM live_chat_messages
		 	ORDER BY created_at DESC
		 	LIMIT ?
		 ) recent
		 LEFT JOIN users u ON u.id = CAST(SUBSTRING(recent.sender_id, 3) AS UNSIGNED)
		 LEFT JOIN user_profiles up ON up.user_id = recent.sender_id
		 ORDER BY created_at ASC`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	messages := make([]ChatMessage, 0, limit)
	for rows.Next() {
		var msg ChatMessage
		var styleRaw sql.NullString
		if err := rows.Scan(&msg.ID, &msg.SenderID, &msg.SenderNickname, &msg.SenderRole, &msg.SenderAvatarURL, &msg.Text, &styleRaw, &msg.CreatedAt); err != nil {
			return nil, err
		}
		if styleRaw.Valid && styleRaw.String != "" {
			var style any
			if json.Unmarshal([]byte(styleRaw.String), &style) == nil {
				msg.ChatStyle = style
			}
		}
		messages = append(messages, msg)
	}
	return messages, rows.Err()
}

func (s *Server) fetchAvatarURL(userID string) string {
	var avatarURL sql.NullString
	_ = s.db.QueryRow(`SELECT avatar_url FROM user_profiles WHERE user_id = ?`, userID).Scan(&avatarURL)
	return avatarURL.String
}

func (s *Server) fetchChatStyle(userID string) (any, error) {
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(s.customizationServiceURL, "/")+"/internal/users/"+userID+"/chat-style", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Customization-Internal-Secret", s.customizationSecret)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("chat_style_unavailable")
	}
	var out chatStyleInternalResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.ChatStyle, nil
}

func nullableBytes(v []byte) any {
	if len(v) == 0 {
		return nil
	}
	return v
}

func (s *Server) broadcast(payload []byte) {
	s.subsMu.RLock()
	defer s.subsMu.RUnlock()
	for _, sub := range s.subscribers {
		select {
		case sub <- payload:
		default:
		}
	}
}

func withJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/stream") {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
		}
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
