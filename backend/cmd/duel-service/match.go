package main

import (
	"encoding/json"
	"fmt"
	"math"
	"time"
)

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
			s.broadcastLocked(m, map[string]any{"type": "phase_changed", "phase": m.Phase, "match": s.snapshotMatch(m)})
		}
		if m.Phase == phaseFinished {
			var recordReq duelRecordRequest
			shouldRecord := false
			if !m.Recorded {
				m.Recorded = true
				recordReq = buildDuelRecord(m)
				shouldRecord = true
			}
			s.store.mu.Unlock()
			if shouldRecord {
				go s.recordFinishedMatch(recordReq)
			}
			return
		}
		s.store.mu.Unlock()
	}
}

func (s *Server) syncPhaseLocked(m *Match) {
	if m.Phase == phaseAwaitingMedia {
		if m.MediaReady[m.PlayerA] && m.MediaReady[m.PlayerB] && !m.PhaseEndsAt.IsZero() && !time.Now().UTC().Before(m.PhaseEndsAt) {
			m.Phase = phasePreStart
			m.PhaseEndsAt = time.Now().UTC().Add(preStartDuration)
		}
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
			s.broadcastLocked(m, s.finishedEventLocked(m))
			return
		default:
			return
		}
	}
}

func (s *Server) handleDisconnectLocked(m *Match, userID string) {
	if isBot(userID) {
		return // bots never disconnect
	}
	if m.Connections[userID] > 0 {
		return
	}
	if m.Phase == phaseFinished || m.Phase == phaseResult || m.Phase == phasePostChat {
		return
	}
	if m.Phase == phaseAwaitingMedia || !m.MediaReady[userID] || !m.MediaReady[m.PlayerA] || !m.MediaReady[m.PlayerB] {
		m.Cancelled = true
		m.Recorded = true
		m.Result = nil
		m.Phase = phaseFinished
		m.PhaseEndsAt = time.Now().UTC()
		delete(s.store.userToMatchID, m.PlayerA)
		delete(s.store.userToMatchID, m.PlayerB)
		s.broadcastLocked(m, map[string]any{
			"type":   "match_cancelled",
			"reason": "media_disconnect",
			"match":  s.snapshotMatch(m),
		})
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
	s.broadcastLocked(m, s.finishedEventLocked(m))
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
		ResultSounds: map[string]ResultSound{
			a.ID: s.defaultResultSound(),
			b.ID: s.defaultResultSound(),
		},
		MediaReady: map[string]bool{
			a.ID: false,
			b.ID: false,
		},
		Subscribers:      map[string]chan []byte{},
		subscriberUserID: map[string]string{},
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

func (s *Server) finishedEventLocked(m *Match) map[string]any {
	payload := map[string]any{
		"type":   "finished",
		"result": m.Result,
	}
	if m.Result != nil && m.Result.WinnerID != "" {
		if sound, ok := m.ResultSounds[m.Result.WinnerID]; ok {
			payload["winner_result_sound_id"] = sound.ID
			payload["winner_result_sound"] = sound
		}
	}
	return payload
}

func buildDuelRecord(m *Match) duelRecordRequest {
	req := duelRecordRequest{
		MatchID:         m.ID,
		Mode:            "duel",
		StartedAt:       m.StartedAt,
		FinishedAt:      m.PhaseEndsAt,
		PlayerAID:       m.PlayerA,
		PlayerANickname: m.Players[m.PlayerA].Nickname,
		PlayerAScore:    m.Players[m.PlayerA].FinalAvg,
		PlayerBID:       m.PlayerB,
		PlayerBNickname: m.Players[m.PlayerB].Nickname,
		PlayerBScore:    m.Players[m.PlayerB].FinalAvg,
	}
	if m.Result != nil {
		req.WinnerID = m.Result.WinnerID
		req.Reason = m.Result.Reason
		if req.PlayerAScore == 0 && req.PlayerBScore == 0 {
			req.PlayerAScore = m.Result.ScoreA
			req.PlayerBScore = m.Result.ScoreB
		}
	}
	return req
}
