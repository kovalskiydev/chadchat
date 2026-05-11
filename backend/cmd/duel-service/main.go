package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"backend/internal/rateutil"
)

const (
	phaseAwaitingMedia = "awaiting_media"
	phasePreStart      = "pre_start"
	phaseScoring       = "scoring"
	phaseOvertime      = "overtime"
	phaseResult        = "result"
	phasePostChat      = "post_chat"
	phaseFinished      = "finished"

	preStartDuration        = 10 * time.Second
	scoringDuration         = 10 * time.Second
	overtimeDuration        = 5 * time.Second
	postChatDuration        = 10 * time.Second
	tieThreshold            = 0.15
	scoreRateLimitPerMinute = 210
)

type Server struct {
	authServiceURL string
	mlServiceURL   string
	store          *Store
	limiter        *rateutil.Limiter
}

type Store struct {
	mu            sync.Mutex
	queue         []authUser
	matches       map[string]*Match
	userToMatchID map[string]string
}

type Match struct {
	ID          string                     `json:"id"`
	PlayerA     string                     `json:"player_a"`
	PlayerB     string                     `json:"player_b"`
	Phase       string                     `json:"phase"`
	StartedAt   time.Time                  `json:"started_at"`
	PhaseEndsAt time.Time                  `json:"phase_ends_at"`
	Result      *MatchResult               `json:"result,omitempty"`
	Players     map[string]*PlayerProgress `json:"players"`
	MediaReady  map[string]bool            `json:"-"`
	Subscribers map[string]chan []byte     `json:"-"`
	Connections map[string]int             `json:"-"`
}

type PlayerProgress struct {
	UserID      string    `json:"user_id"`
	Nickname    string    `json:"nickname"`
	LastScore   float64   `json:"last_score"`
	RunningAvg  float64   `json:"running_avg"`
	FinalAvg    float64   `json:"final_avg"`
	Samples     int       `json:"samples"`
	LastUpdated time.Time `json:"last_updated"`
}

type MatchResult struct {
	WinnerID string  `json:"winner_id,omitempty"`
	LoserID  string  `json:"loser_id,omitempty"`
	Reason   string  `json:"reason"`
	ScoreA   float64 `json:"score_a"`
	ScoreB   float64 `json:"score_b"`
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

type scoreFrameRequest struct {
	ImageBase64 string `json:"image_base64"`
}

type signalRequest struct {
	Type      string `json:"type"`
	SDP       string `json:"sdp,omitempty"`
	Candidate string `json:"candidate,omitempty"`
	SDPMid    string `json:"sdp_mid,omitempty"`
	SDPMLine  int    `json:"sdp_mline_index,omitempty"`
}

type mlPredictResponse struct {
	Score float64 `json:"score"`
}

func main() {
	s := &Server{
		authServiceURL: envOr("AUTH_SERVICE_URL", "http://localhost:8081"),
		mlServiceURL:   envOr("ML_SERVICE_URL", "http://localhost:8090"),
		store: &Store{
			queue:         []authUser{},
			matches:       map[string]*Match{},
			userToMatchID: map[string]string{},
		},
		limiter: rateutil.NewLimiter(),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("POST /duel/queue/join", s.withAuth(s.handleJoinQueue))
	mux.HandleFunc("POST /duel/queue/leave", s.withAuth(s.handleLeaveQueue))
	mux.HandleFunc("GET /duel/match/current", s.withAuth(s.handleCurrentMatch))
	mux.HandleFunc("GET /duel/match/{matchID}", s.withAuth(s.handleGetMatch))
	mux.HandleFunc("GET /duel/match/{matchID}/stream", s.withAuth(s.handleStream))
	mux.HandleFunc("POST /duel/match/{matchID}/media-ready", s.withAuth(s.handleMediaReady))
	mux.HandleFunc("POST /duel/match/{matchID}/signal", s.withAuth(s.handleSignal))
	mux.HandleFunc("POST /duel/match/{matchID}/score-frame", s.withRateLimit(scoreRateLimitPerMinute, time.Minute, s.withAuth(s.handleScoreFrame)))

	addr := ":" + envOr("PORT", "8085")
	log.Printf("duel-service on %s", addr)
	log.Fatal(http.ListenAndServe(addr, withJSON(mux)))
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"status": "ok",
	})
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

func (s *Server) withAuth(next func(http.ResponseWriter, *http.Request, authUser)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			writeErr(w, http.StatusUnauthorized, "missing_bearer_token")
			return
		}
		user, err := s.resolveUser(h)
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
	return authUser{ID: me.User.ID, Nickname: me.User.Nickname}, nil
}

func (s *Server) handleJoinQueue(w http.ResponseWriter, _ *http.Request, user authUser) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()

	if mid, ok := s.store.userToMatchID[user.ID]; ok {
		match := s.store.matches[mid]
		if match == nil {
			delete(s.store.userToMatchID, user.ID)
		} else {
			s.syncPhaseLocked(match)
			if releasableForRematch(match.Phase) {
				delete(s.store.userToMatchID, user.ID)
			} else {
				writeJSON(w, http.StatusOK, map[string]any{"status": "already_in_match", "match_id": mid})
				return
			}
		}
	}
	for _, queued := range s.store.queue {
		if queued.ID == user.ID {
			writeJSON(w, http.StatusOK, map[string]any{"status": "searching"})
			return
		}
	}

	if len(s.store.queue) == 0 {
		s.store.queue = append(s.store.queue, user)
		writeJSON(w, http.StatusOK, map[string]any{"status": "searching"})
		return
	}

	opponent := s.store.queue[0]
	s.store.queue = s.store.queue[1:]
	if opponent.ID == user.ID {
		s.store.queue = append(s.store.queue, user)
		writeJSON(w, http.StatusOK, map[string]any{"status": "searching"})
		return
	}

	match := s.newMatchLocked(opponent, user)
	s.store.userToMatchID[opponent.ID] = match.ID
	s.store.userToMatchID[user.ID] = match.ID
	s.store.matches[match.ID] = match
	go s.runMatchLifecycle(match.ID)

	s.broadcastLocked(match, map[string]any{"type": "match_found", "match": snapshotMatch(match)})
	writeJSON(w, http.StatusOK, map[string]any{"status": "matched", "match_id": match.ID})
}

func (s *Server) handleLeaveQueue(w http.ResponseWriter, _ *http.Request, user authUser) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	filtered := s.store.queue[:0]
	for _, queued := range s.store.queue {
		if queued.ID != user.ID {
			filtered = append(filtered, queued)
		}
	}
	s.store.queue = filtered
	writeJSON(w, http.StatusOK, map[string]any{"status": "left_queue"})
}

func (s *Server) handleCurrentMatch(w http.ResponseWriter, _ *http.Request, user authUser) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	mid, ok := s.store.userToMatchID[user.ID]
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"match": nil})
		return
	}
	m := s.store.matches[mid]
	if m == nil {
		writeJSON(w, http.StatusOK, map[string]any{"match": nil})
		return
	}
	s.syncPhaseLocked(m)
	writeJSON(w, http.StatusOK, map[string]any{"match": snapshotMatch(m)})
}

func (s *Server) handleGetMatch(w http.ResponseWriter, r *http.Request, user authUser) {
	mid := r.PathValue("matchID")
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	m := s.store.matches[mid]
	if m == nil {
		writeErr(w, http.StatusNotFound, "match_not_found")
		return
	}
	if !isPlayer(m, user.ID) {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	s.syncPhaseLocked(m)
	writeJSON(w, http.StatusOK, map[string]any{"match": snapshotMatch(m)})
}

func (s *Server) handleScoreFrame(w http.ResponseWriter, r *http.Request, user authUser) {
	mid := r.PathValue("matchID")
	var req scoreFrameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if strings.TrimSpace(req.ImageBase64) == "" {
		writeErr(w, http.StatusBadRequest, "missing_image_base64")
		return
	}

	s.store.mu.Lock()
	m := s.store.matches[mid]
	if m == nil {
		s.store.mu.Unlock()
		writeErr(w, http.StatusNotFound, "match_not_found")
		return
	}
	if !isPlayer(m, user.ID) {
		s.store.mu.Unlock()
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	s.syncPhaseLocked(m)
	if m.Phase != phaseScoring && m.Phase != phaseOvertime {
		s.store.mu.Unlock()
		writeErr(w, http.StatusBadRequest, "scoring_not_active")
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
	m = s.store.matches[mid]
	if m == nil || !isPlayer(m, user.ID) {
		writeErr(w, http.StatusNotFound, "match_not_found")
		return
	}
	s.syncPhaseLocked(m)
	if m.Phase != phaseScoring && m.Phase != phaseOvertime {
		writeErr(w, http.StatusBadRequest, "scoring_not_active")
		return
	}
	p := m.Players[user.ID]
	p.Samples++
	p.LastScore = score
	p.RunningAvg = ((p.RunningAvg * float64(p.Samples-1)) + score) / float64(p.Samples)
	p.LastUpdated = time.Now().UTC()
	opp := otherPlayer(m, user.ID)

	resp := map[string]any{
		"phase":            m.Phase,
		"seconds_left":     secondsLeft(m.PhaseEndsAt),
		"my_score":         p.LastScore,
		"my_running_avg":   p.RunningAvg,
		"my_samples":       p.Samples,
		"opponent_score":   opp.LastScore,
		"opponent_running": opp.RunningAvg,
		"opponent_samples": opp.Samples,
	}
	s.broadcastLocked(m, map[string]any{"type": "score_update", "match_id": m.ID, "payload": resp})
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleSignal(w http.ResponseWriter, r *http.Request, user authUser) {
	mid := r.PathValue("matchID")
	var req signalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.Type = strings.TrimSpace(req.Type)
	if req.Type != "offer" && req.Type != "answer" && req.Type != "ice-candidate" {
		writeErr(w, http.StatusBadRequest, "invalid_signal_type")
		return
	}
	if (req.Type == "offer" || req.Type == "answer") && strings.TrimSpace(req.SDP) == "" {
		writeErr(w, http.StatusBadRequest, "missing_sdp")
		return
	}
	if req.Type == "ice-candidate" && strings.TrimSpace(req.Candidate) == "" {
		writeErr(w, http.StatusBadRequest, "missing_candidate")
		return
	}

	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	m := s.store.matches[mid]
	if m == nil {
		writeErr(w, http.StatusNotFound, "match_not_found")
		return
	}
	if !isPlayer(m, user.ID) {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	s.syncPhaseLocked(m)
	if m.Phase == phaseResult || m.Phase == phaseFinished {
		writeErr(w, http.StatusBadRequest, "signaling_not_allowed_in_current_phase")
		return
	}
	to := m.PlayerA
	if user.ID == m.PlayerA {
		to = m.PlayerB
	}
	s.broadcastLocked(m, map[string]any{
		"type": "webrtc_signal",
		"payload": map[string]any{
			"match_id":        m.ID,
			"from_user_id":    user.ID,
			"to_user_id":      to,
			"signal_type":     req.Type,
			"sdp":             req.SDP,
			"candidate":       req.Candidate,
			"sdp_mid":         req.SDPMid,
			"sdp_mline_index": req.SDPMLine,
			"phase":           m.Phase,
		},
	})
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

func (s *Server) handleMediaReady(w http.ResponseWriter, r *http.Request, user authUser) {
	mid := r.PathValue("matchID")

	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	m := s.store.matches[mid]
	if m == nil {
		writeErr(w, http.StatusNotFound, "match_not_found")
		return
	}
	if !isPlayer(m, user.ID) {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	if m.Phase == phaseResult || m.Phase == phaseFinished || m.Phase == phasePostChat {
		writeErr(w, http.StatusBadRequest, "match_not_ready_for_media")
		return
	}

	m.MediaReady[user.ID] = true
	if m.MediaReady[m.PlayerA] && m.MediaReady[m.PlayerB] && m.Phase == phaseAwaitingMedia {
		m.Phase = phasePreStart
		m.PhaseEndsAt = time.Now().UTC().Add(preStartDuration)
		s.broadcastLocked(m, map[string]any{"type": "phase_changed", "phase": m.Phase, "match": snapshotMatch(m)})
	} else {
		s.broadcastLocked(m, map[string]any{
			"type":  "media_ready_update",
			"match": snapshotMatch(m),
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "match": snapshotMatch(m)})
}

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request, user authUser) {
	mid := r.PathValue("matchID")
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "stream_not_supported")
		return
	}

	subID := fmt.Sprintf("sub_%d", time.Now().UnixNano())
	sub := make(chan []byte, 64)

	s.store.mu.Lock()
	m := s.store.matches[mid]
	if m == nil {
		s.store.mu.Unlock()
		writeErr(w, http.StatusNotFound, "match_not_found")
		return
	}
	if !isPlayer(m, user.ID) {
		s.store.mu.Unlock()
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	m.Subscribers[subID] = sub
	m.Connections[user.ID]++
	s.syncPhaseLocked(m)
	initial := snapshotMatch(m)
	s.store.mu.Unlock()

	defer func() {
		s.store.mu.Lock()
		if mm := s.store.matches[mid]; mm != nil {
			delete(mm.Subscribers, subID)
			if mm.Connections[user.ID] > 0 {
				mm.Connections[user.ID]--
			}
			s.handleDisconnectLocked(mm, user.ID)
		}
		s.store.mu.Unlock()
		close(sub)
	}()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	joined, _ := json.Marshal(map[string]any{"type": "joined", "match": initial})
	_, _ = fmt.Fprintf(w, "data: %s\n\n", joined)
	flusher.Flush()

	tick := time.NewTicker(1 * time.Second)
	defer tick.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-tick.C:
			s.store.mu.Lock()
			mm := s.store.matches[mid]
			if mm == nil {
				s.store.mu.Unlock()
				return
			}
			s.syncPhaseLocked(mm)
			payload, _ := json.Marshal(map[string]any{"type": "timer", "phase": mm.Phase, "seconds_left": secondsLeft(mm.PhaseEndsAt)})
			s.store.mu.Unlock()
			_, _ = fmt.Fprintf(w, "data: %s\n\n", payload)
			flusher.Flush()
		case payload := <-sub:
			_, _ = fmt.Fprintf(w, "data: %s\n\n", payload)
			flusher.Flush()
		}
	}
}

func (s *Server) runMatchLifecycle(matchID string) {
	t := time.NewTicker(300 * time.Millisecond)
	defer t.Stop()
	for range t.C {
		s.store.mu.Lock()
		m := s.store.matches[matchID]
		if m == nil {
			s.store.mu.Unlock()
			return
		}
		prev := m.Phase
		s.syncPhaseLocked(m)
		if prev != m.Phase {
			s.broadcastLocked(m, map[string]any{"type": "phase_changed", "phase": m.Phase, "match": snapshotMatch(m)})
		}
		if m.Phase == phaseFinished {
			s.store.mu.Unlock()
			return
		}
		s.store.mu.Unlock()
	}
}

func (s *Server) syncPhaseLocked(m *Match) {
	if m.Phase == phaseAwaitingMedia {
		return
	}
	now := time.Now().UTC()
	for {
		if now.Before(m.PhaseEndsAt) {
			return
		}
		switch m.Phase {
		case phasePreStart:
			m.Phase = phaseScoring
			m.PhaseEndsAt = now.Add(scoringDuration)
		case phaseScoring:
			s.finalizeScoresLocked(m)
			a := m.Players[m.PlayerA].FinalAvg
			b := m.Players[m.PlayerB].FinalAvg
			if math.Abs(a-b) < tieThreshold {
				m.Phase = phaseOvertime
				m.PhaseEndsAt = now.Add(overtimeDuration)
			} else {
				m.Phase = phaseResult
				m.PhaseEndsAt = now.Add(1500 * time.Millisecond)
			}
		case phaseOvertime:
			s.finalizeScoresLocked(m)
			m.Phase = phaseResult
			m.PhaseEndsAt = now.Add(1500 * time.Millisecond)
		case phaseResult:
			m.Phase = phasePostChat
			m.PhaseEndsAt = now.Add(postChatDuration)
		case phasePostChat:
			m.Phase = phaseFinished
			m.PhaseEndsAt = now
			delete(s.store.userToMatchID, m.PlayerA)
			delete(s.store.userToMatchID, m.PlayerB)
			s.broadcastLocked(m, map[string]any{"type": "finished", "result": m.Result})
			return
		default:
			return
		}
	}
}

func (s *Server) handleDisconnectLocked(m *Match, userID string) {
	if m.Connections[userID] > 0 {
		return
	}
	if m.Phase == phaseFinished || m.Phase == phaseResult || m.Phase == phasePostChat {
		return
	}
	opponent := m.PlayerA
	if userID == m.PlayerA {
		opponent = m.PlayerB
	}
	scoreA := m.Players[m.PlayerA].RunningAvg
	scoreB := m.Players[m.PlayerB].RunningAvg
	m.Result = &MatchResult{
		WinnerID: opponent,
		LoserID:  userID,
		Reason:   "disconnect",
		ScoreA:   scoreA,
		ScoreB:   scoreB,
	}
	m.Phase = phaseFinished
	m.PhaseEndsAt = time.Now().UTC()
	delete(s.store.userToMatchID, m.PlayerA)
	delete(s.store.userToMatchID, m.PlayerB)
	s.broadcastLocked(m, map[string]any{"type": "finished", "result": m.Result})
}

func (s *Server) finalizeScoresLocked(m *Match) {
	for _, p := range m.Players {
		p.FinalAvg = p.RunningAvg
	}
	a := m.Players[m.PlayerA].FinalAvg
	b := m.Players[m.PlayerB].FinalAvg
	if math.Abs(a-b) < tieThreshold {
		m.Result = &MatchResult{Reason: "draw", ScoreA: a, ScoreB: b}
		return
	}
	winnerID, loserID := m.PlayerA, m.PlayerB
	if b > a {
		winnerID, loserID = m.PlayerB, m.PlayerA
	}
	m.Result = &MatchResult{WinnerID: winnerID, LoserID: loserID, Reason: "score", ScoreA: a, ScoreB: b}
}

func (s *Server) newMatchLocked(a, b authUser) *Match {
	if a.ID > b.ID {
		a, b = b, a
	}
	id := fmt.Sprintf("duel_%d", time.Now().UnixNano())
	now := time.Now().UTC()
	return &Match{
		ID:          id,
		PlayerA:     a.ID,
		PlayerB:     b.ID,
		Phase:       phaseAwaitingMedia,
		StartedAt:   now,
		PhaseEndsAt: time.Time{},
		Players: map[string]*PlayerProgress{
			a.ID: {UserID: a.ID, Nickname: a.Nickname},
			b.ID: {UserID: b.ID, Nickname: b.Nickname},
		},
		MediaReady: map[string]bool{
			a.ID: false,
			b.ID: false,
		},
		Subscribers: map[string]chan []byte{},
		Connections: map[string]int{
			a.ID: 0,
			b.ID: 0,
		},
	}
}

func (s *Server) broadcastLocked(m *Match, msg map[string]any) {
	b, _ := json.Marshal(msg)
	for _, ch := range m.Subscribers {
		select {
		case ch <- b:
		default:
		}
	}
}

func snapshotMatch(m *Match) map[string]any {
	players := []map[string]any{}
	for _, p := range m.Players {
		players = append(players, map[string]any{
			"user_id":      p.UserID,
			"nickname":     p.Nickname,
			"last_score":   p.LastScore,
			"running_avg":  p.RunningAvg,
			"final_avg":    p.FinalAvg,
			"samples":      p.Samples,
			"last_updated": p.LastUpdated,
		})
	}
	sort.Slice(players, func(i, j int) bool { return players[i]["user_id"].(string) < players[j]["user_id"].(string) })
	return map[string]any{
		"id":            m.ID,
		"player_a":      m.PlayerA,
		"player_b":      m.PlayerB,
		"phase":         m.Phase,
		"started_at":    m.StartedAt,
		"phase_ends_at": m.PhaseEndsAt,
		"seconds_left":  secondsLeft(m.PhaseEndsAt),
		"players":       players,
		"media_ready": map[string]bool{
			m.PlayerA: m.MediaReady[m.PlayerA],
			m.PlayerB: m.MediaReady[m.PlayerB],
		},
		"result": m.Result,
	}
}

func isPlayer(m *Match, userID string) bool { return userID == m.PlayerA || userID == m.PlayerB }

func releasableForRematch(phase string) bool {
	return phase == phaseResult || phase == phasePostChat || phase == phaseFinished
}

func otherPlayer(m *Match, userID string) *PlayerProgress {
	if userID == m.PlayerA {
		return m.Players[m.PlayerB]
	}
	return m.Players[m.PlayerA]
}

func secondsLeft(t time.Time) int64 {
	d := time.Until(t)
	if d <= 0 {
		return 0
	}
	return int64(math.Ceil(d.Seconds()))
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
