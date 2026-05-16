package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"backend/internal/httputil"
)

func (s *Server) handleRTCConfig(w http.ResponseWriter, _ *http.Request, _ authUser) {
	httputil.WriteJSON(w, http.StatusOK, rtcConfigResponse{ICEServers: s.buildICEServers()})
}

func (s *Server) handleScoreFrame(w http.ResponseWriter, r *http.Request, user authUser) {
	mid := r.PathValue("matchID")
	var req scoreFrameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if strings.TrimSpace(req.ImageBase64) == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_image_base64")
		return
	}

	s.store.mu.Lock()
	m := s.store.matches[mid]
	if m == nil {
		s.store.mu.Unlock()
		httputil.WriteErr(w, http.StatusNotFound, "match_not_found")
		return
	}
	if !isPlayer(m, user.ID) {
		s.store.mu.Unlock()
		httputil.WriteErr(w, http.StatusForbidden, "forbidden")
		return
	}
	s.syncPhaseLocked(m)
	if m.Phase != phaseScoring && m.Phase != phaseOvertime {
		s.store.mu.Unlock()
		httputil.WriteErr(w, http.StatusBadRequest, "scoring_not_active")
		return
	}
	s.store.mu.Unlock()

	score, err := s.predictScore(req.ImageBase64)
	if err != nil {
		httputil.WriteErr(w, http.StatusBadGateway, "ml_service_unavailable")
		return
	}

	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	m = s.store.matches[mid]
	if m == nil || !isPlayer(m, user.ID) {
		httputil.WriteErr(w, http.StatusNotFound, "match_not_found")
		return
	}
	s.syncPhaseLocked(m)
	if m.Phase != phaseScoring && m.Phase != phaseOvertime {
		httputil.WriteErr(w, http.StatusBadRequest, "scoring_not_active")
		return
	}
	p := m.Players[user.ID]
	p.Samples++
	p.LastScore = score
	p.RunningAvg = ((p.RunningAvg * float64(p.Samples-1)) + score) / float64(p.Samples)
	p.LastUpdated = time.Now().UTC()
	opp := otherPlayer(m, user.ID)

	base := map[string]any{
		"phase":        m.Phase,
		"seconds_left": secondsLeft(m.PhaseEndsAt),
	}

	// personalised payload per player because "my" / "opponent" are relative
	// Subscribers are keyed by subID (not userID), so we need to track which user owns which channel.
	for subID, ch := range m.Subscribers {
		uid := m.subscriberUserID[subID]
		if uid == "" {
			continue
		}
		me := m.Players[uid]
		if me == nil {
			continue
		}
		them := otherPlayer(m, uid)
		payload := map[string]any{
			"phase":            base["phase"],
			"seconds_left":     base["seconds_left"],
			"my_score":         me.LastScore,
			"my_running_avg":   me.RunningAvg,
			"my_samples":       me.Samples,
			"opponent_score":   them.LastScore,
			"opponent_running": them.RunningAvg,
			"opponent_samples": them.Samples,
		}
		b, _ := json.Marshal(map[string]any{"type": "score_update", "match_id": m.ID, "payload": payload})
		select {
		case ch <- b:
		default:
		}
	}

	resp := map[string]any{
		"phase":            base["phase"],
		"seconds_left":     base["seconds_left"],
		"my_score":         p.LastScore,
		"my_running_avg":   p.RunningAvg,
		"my_samples":       p.Samples,
		"opponent_score":   opp.LastScore,
		"opponent_running": opp.RunningAvg,
		"opponent_samples": opp.Samples,
	}
	httputil.WriteJSON(w, http.StatusOK, resp)
}

func (s *Server) handleSignal(w http.ResponseWriter, r *http.Request, user authUser) {
	mid := r.PathValue("matchID")
	var req signalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.Type = strings.TrimSpace(req.Type)
	if req.Type != "offer" && req.Type != "answer" && req.Type != "ice-candidate" {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_signal_type")
		return
	}
	if (req.Type == "offer" || req.Type == "answer") && strings.TrimSpace(req.SDP) == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_sdp")
		return
	}
	if req.Type == "ice-candidate" && strings.TrimSpace(req.Candidate) == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_candidate")
		return
	}

	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	m := s.store.matches[mid]
	if m == nil {
		httputil.WriteErr(w, http.StatusNotFound, "match_not_found")
		return
	}
	if !isPlayer(m, user.ID) {
		httputil.WriteErr(w, http.StatusForbidden, "forbidden")
		return
	}
	s.syncPhaseLocked(m)
	if m.Phase == phaseResult || m.Phase == phaseFinished {
		httputil.WriteErr(w, http.StatusBadRequest, "signaling_not_allowed_in_current_phase")
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
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

func (s *Server) handleMediaReady(w http.ResponseWriter, r *http.Request, user authUser) {
	mid := r.PathValue("matchID")

	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	m := s.store.matches[mid]
	if m == nil {
		httputil.WriteErr(w, http.StatusNotFound, "match_not_found")
		return
	}
	if !isPlayer(m, user.ID) {
		httputil.WriteErr(w, http.StatusForbidden, "forbidden")
		return
	}
	if m.Phase == phaseResult || m.Phase == phaseFinished || m.Phase == phasePostChat {
		httputil.WriteErr(w, http.StatusBadRequest, "match_not_ready_for_media")
		return
	}

	m.MediaReady[user.ID] = true
	if m.MediaReady[m.PlayerA] && m.MediaReady[m.PlayerB] && m.Phase == phaseAwaitingMedia {
		m.PhaseEndsAt = time.Now().UTC().Add(mediaReadyGraceDuration)
		s.broadcastLocked(m, map[string]any{
			"type":              "media_ready_update",
			"match":             snapshotMatch(m),
			"pre_start_in_sec":  int64(mediaReadyGraceDuration / time.Second),
			"media_grace_phase": true,
		})
	} else {
		s.broadcastLocked(m, map[string]any{
			"type":  "media_ready_update",
			"match": snapshotMatch(m),
		})
	}

	httputil.WriteJSON(w, http.StatusOK, map[string]any{"status": "ok", "match": snapshotMatch(m)})
}

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request, user authUser) {
	mid := r.PathValue("matchID")
	flusher, ok := w.(http.Flusher)
	if !ok {
		httputil.WriteErr(w, http.StatusInternalServerError, "stream_not_supported")
		return
	}

	subID := fmt.Sprintf("sub_%d", time.Now().UnixNano())
	sub := make(chan []byte, 64)

	s.store.mu.Lock()
	m := s.store.matches[mid]
	if m == nil {
		s.store.mu.Unlock()
		httputil.WriteErr(w, http.StatusNotFound, "match_not_found")
		return
	}
	if !isPlayer(m, user.ID) {
		s.store.mu.Unlock()
		httputil.WriteErr(w, http.StatusForbidden, "forbidden")
		return
	}
	m.Subscribers[subID] = sub
	m.subscriberUserID[subID] = user.ID
	m.Connections[user.ID]++
	s.syncPhaseLocked(m)
	initial := snapshotMatch(m)
	s.store.mu.Unlock()

	defer func() {
		s.store.mu.Lock()
		if mm := s.store.matches[mid]; mm != nil {
			delete(mm.Subscribers, subID)
			delete(mm.subscriberUserID, subID)
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
