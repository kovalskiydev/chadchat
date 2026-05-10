package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type Server struct {
	authServiceURL string
	store          *Store
}

type Store struct {
	mu          sync.RWMutex
	messages    []ChatMessage
	subscribers map[string]chan []byte
}

type ChatMessage struct {
	ID             string    `json:"id"`
	SenderID       string    `json:"sender_id"`
	SenderNickname string    `json:"sender_nickname"`
	Text           string    `json:"text"`
	CreatedAt      time.Time `json:"created_at"`
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
	} `json:"user"`
}

type authUser struct {
	ID       string
	Nickname string
}

func main() {
	s := &Server{
		authServiceURL: envOr("AUTH_SERVICE_URL", "http://localhost:8081"),
		store: &Store{
			messages:    make([]ChatMessage, 0, 200),
			subscribers: map[string]chan []byte{},
		},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /live-chat/history", s.withAuth(s.handleHistory))
	mux.HandleFunc("POST /live-chat/history", s.withAuth(s.handleHistoryWithLimit))
	mux.HandleFunc("GET /live-chat/stream", s.withAuth(s.handleStream))
	mux.HandleFunc("POST /live-chat/messages", s.withAuth(s.handlePostMessage))

	addr := ":" + envOr("PORT", "8084")
	log.Printf("live-chat-service on %s", addr)
	log.Fatal(http.ListenAndServe(addr, withJSON(mux)))
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
	return authUser{
		ID:       me.User.ID,
		Nickname: me.User.Nickname,
	}, nil
}

func (s *Server) handleHistory(w http.ResponseWriter, _ *http.Request, _ authUser) {
	s.store.mu.RLock()
	messages := append([]ChatMessage(nil), s.store.messages...)
	s.store.mu.RUnlock()
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

	s.store.mu.RLock()
	total := len(s.store.messages)
	start := total - req.Limit
	if start < 0 {
		start = 0
	}
	messages := append([]ChatMessage(nil), s.store.messages[start:]...)
	s.store.mu.RUnlock()

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
		Text:           text,
		CreatedAt:      time.Now().UTC(),
	}
	payload, _ := json.Marshal(map[string]any{"type": "message", "message": msg})

	s.store.mu.Lock()
	s.store.messages = append(s.store.messages, msg)
	if len(s.store.messages) > 1000 {
		s.store.messages = append([]ChatMessage(nil), s.store.messages[len(s.store.messages)-1000:]...)
	}
	for _, sub := range s.store.subscribers {
		select {
		case sub <- payload:
		default:
		}
	}
	s.store.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{"message": msg})
}

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request, user authUser) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "stream_not_supported")
		return
	}

	subID := fmt.Sprintf("sub_%d", time.Now().UnixNano())
	sub := make(chan []byte, 64)

	s.store.mu.Lock()
	s.store.subscribers[subID] = sub
	history := append([]ChatMessage(nil), s.store.messages...)
	s.store.mu.Unlock()

	defer func() {
		s.store.mu.Lock()
		delete(s.store.subscribers, subID)
		s.store.mu.Unlock()
		close(sub)
	}()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	joined, _ := json.Marshal(map[string]any{"type": "joined", "user_id": user.ID, "nickname": user.Nickname})
	_, _ = fmt.Fprintf(w, "data: %s\n\n", joined)
	for _, m := range history {
		p, _ := json.Marshal(map[string]any{"type": "history", "message": m})
		_, _ = fmt.Fprintf(w, "data: %s\n\n", p)
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

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
