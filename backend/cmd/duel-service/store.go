package main

import (
	"math"
	"net/http"
	"sort"
	"time"

	"backend/internal/httputil"
)

func (s *Server) handleJoinQueue(w http.ResponseWriter, _ *http.Request, user authUser) {
	s.store.mu.Lock()
	if mid, ok := s.store.userToMatchID[user.ID]; ok {
		match := s.store.matches[mid]
		if match == nil {
			delete(s.store.userToMatchID, user.ID)
		} else {
			s.syncPhaseLocked(match)
			if releasableForRematch(match.Phase) {
				delete(s.store.userToMatchID, user.ID)
			} else {
				s.store.mu.Unlock()
				httputil.WriteJSON(w, http.StatusOK, map[string]any{"status": "already_in_match", "match_id": mid})
				return
			}
		}
	}
	for _, queued := range s.store.queue {
		if queued.ID == user.ID {
			s.store.mu.Unlock()
			httputil.WriteJSON(w, http.StatusOK, map[string]any{"status": "searching"})
			return
		}
	}

	// check if there's a bot in queue (injected by runBotInjector after delay)
	for i, queued := range s.store.queue {
		if isBot(queued.ID) {
			// match human with waiting bot
			bot := s.store.queue[i]
			s.store.queue = append(s.store.queue[:i], s.store.queue[i+1:]...)
			match := s.newMatchLocked(bot, user)
			if len(s.botVideoURLs) > 0 {
				match.BotVideoURL = randomPick(s.botVideoURLs)
			}
			s.store.userToMatchID[bot.ID] = match.ID
			s.store.userToMatchID[user.ID] = match.ID
			s.store.matches[match.ID] = match
			s.store.mu.Unlock()

			go s.runMatchLifecycle(match.ID)
			go s.botMatchSetup(match.ID)
			go s.runBotScoring(match.ID)
			s.hydrateMatchResultSounds(match.ID)

			s.store.mu.Lock()
			created := s.store.matches[match.ID]
			if created != nil {
				s.broadcastLocked(created, map[string]any{"type": "match_found", "match": s.snapshotMatch(created)})
			}
			s.store.mu.Unlock()
			httputil.WriteJSON(w, http.StatusOK, map[string]any{"status": "matched", "match_id": match.ID})
			return
		}
	}

	// no bot available — human waits in queue
	s.store.queue = append(s.store.queue, user)
	s.store.queueJoinedAt[user.ID] = time.Now().UTC()
	s.store.mu.Unlock()
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"status": "searching"})
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
	delete(s.store.queueJoinedAt, user.ID)
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"status": "left_queue"})
}

func (s *Server) handleCurrentMatch(w http.ResponseWriter, _ *http.Request, user authUser) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	mid, ok := s.store.userToMatchID[user.ID]
	if !ok {
		httputil.WriteJSON(w, http.StatusOK, map[string]any{"match": nil})
		return
	}
	m := s.store.matches[mid]
	if m == nil {
		httputil.WriteJSON(w, http.StatusOK, map[string]any{"match": nil})
		return
	}
	s.syncPhaseLocked(m)
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"match": s.snapshotMatch(m)})
}

func (s *Server) handleGetMatch(w http.ResponseWriter, r *http.Request, user authUser) {
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
	s.syncPhaseLocked(m)
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"match": s.snapshotMatch(m)})
}

func (s *Server) snapshotMatch(m *Match) map[string]any {
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
	out := map[string]any{
		"id":            m.ID,
		"player_a":      m.PlayerA,
		"player_b":      m.PlayerB,
		"phase":         m.Phase,
		"started_at":    m.StartedAt,
		"phase_ends_at": m.PhaseEndsAt,
		"seconds_left":  secondsLeft(m.PhaseEndsAt),
		"players":       players,
		"result_sounds": map[string]ResultSound{
			m.PlayerA: m.ResultSounds[m.PlayerA],
			m.PlayerB: m.ResultSounds[m.PlayerB],
		},
		"media_ready": map[string]bool{
			m.PlayerA: m.MediaReady[m.PlayerA],
			m.PlayerB: m.MediaReady[m.PlayerB],
		},
		"result": m.Result,
	}
	// if opponent is a bot, tell the frontend where to fetch the fake video
	if m.BotVideoURL != "" {
		if isBot(m.PlayerA) {
			out["bot_video_url"] = m.BotVideoURL
			out["bot_opponent_id"] = m.PlayerA
		} else if isBot(m.PlayerB) {
			out["bot_video_url"] = m.BotVideoURL
			out["bot_opponent_id"] = m.PlayerB
		}
	}
	return out
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
