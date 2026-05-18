package main

import (
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"strings"
	"time"
)

var botNicknames = []string{
	"CyberStacy", "NeonKate", "PixelMia", "GlitchLena", "VoxelAnna",
	"DataSophie", "ByteEmma", "AlgoZoe", "TensorLily", "MatrixChloe",
}

func botUser() authUser {
	return authUser{
		ID:       fmt.Sprintf("%s%d", botPrefix, time.Now().UnixNano()),
		Nickname: botNicknames[rand.Intn(len(botNicknames))],
	}
}

func isBot(id string) bool { return strings.HasPrefix(id, botPrefix) }

// botMatchSetup marks bot as media-ready immediately and skips WebRTC.
func (s *Server) botMatchSetup(matchID string) {
	s.store.mu.Lock()
	m := s.store.matches[matchID]
	if m == nil {
		s.store.mu.Unlock()
		return
	}
	var botID string
	if isBot(m.PlayerA) {
		botID = m.PlayerA
	} else if isBot(m.PlayerB) {
		botID = m.PlayerB
	} else {
		s.store.mu.Unlock()
		return
	}
	m.MediaReady[botID] = true
	m.Connections[botID] = 1 // pretend bot is connected so it never disconnect-cancels
	if m.MediaReady[m.PlayerA] && m.MediaReady[m.PlayerB] && m.Phase == phaseAwaitingMedia {
		m.PhaseEndsAt = time.Now().UTC().Add(mediaReadyGraceDuration)
		s.broadcastLocked(m, map[string]any{
			"type":              "media_ready_update",
			"match":             s.snapshotMatch(m),
			"pre_start_in_sec":  int64(mediaReadyGraceDuration / time.Second),
			"media_grace_phase": true,
		})
	}
	s.store.mu.Unlock()
}

// runBotScoring sends periodic score updates for the bot during scoring/overtime.
func (s *Server) runBotScoring(matchID string) {
	ticker := time.NewTicker(s.botScoreInterval)
	defer ticker.Stop()

	for range ticker.C {
		s.store.mu.Lock()
		m := s.store.matches[matchID]
		if m == nil || (m.Phase != phaseScoring && m.Phase != phaseOvertime) {
			s.store.mu.Unlock()
			return
		}

		var botID string
		if isBot(m.PlayerA) {
			botID = m.PlayerA
		} else if isBot(m.PlayerB) {
			botID = m.PlayerB
		} else {
			s.store.mu.Unlock()
			return
		}

		p := m.Players[botID]
		score := randomBotScore(s.botSkillMin, s.botSkillMax)
		p.Samples++
		p.LastScore = score
		p.RunningAvg = ((p.RunningAvg * float64(p.Samples-1)) + score) / float64(p.Samples)
		p.LastUpdated = time.Now().UTC()

		base := map[string]any{
			"phase":        m.Phase,
			"seconds_left": secondsLeft(m.PhaseEndsAt),
		}

		// broadcast personalised score_update to human only (bot has no SSE channel)
		for subID, ch := range m.Subscribers {
			uid := m.subscriberUserID[subID]
			if uid == "" || isBot(uid) {
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
		s.store.mu.Unlock()
	}
}

// runBotInjector checks queue every second and creates a bot match if a human
// has been waiting longer than botInjectDelay.
func (s *Server) runBotInjector() {
	if !s.botEnabled {
		return
	}
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		s.store.mu.Lock()
		now := time.Now().UTC()
		for _, q := range s.store.queue {
			if isBot(q.ID) {
				continue
			}
			joinedAt, ok := s.store.queueJoinedAt[q.ID]
			if !ok {
				continue
			}
			if now.Sub(joinedAt) >= botInjectDelay {
				// remove human from queue and match with bot immediately
				filtered := s.store.queue[:0]
				for _, queued := range s.store.queue {
					if queued.ID != q.ID {
						filtered = append(filtered, queued)
					}
				}
				s.store.queue = filtered
				delete(s.store.queueJoinedAt, q.ID)

				bot := botUser()
				match := s.newMatchLocked(bot, q)
				if len(s.botVideoURLs) > 0 {
					match.BotVideoURL = randomPick(s.botVideoURLs)
				}
				s.store.userToMatchID[bot.ID] = match.ID
				s.store.userToMatchID[q.ID] = match.ID
				s.store.matches[match.ID] = match

				go s.runMatchLifecycle(match.ID)
				go s.botMatchSetup(match.ID)
				go s.runBotScoring(match.ID)
				go s.hydrateMatchResultSounds(match.ID)

				created := s.store.matches[match.ID]
				if created != nil {
					s.broadcastLocked(created, map[string]any{"type": "match_found", "match": s.snapshotMatch(created)})
				}
			}
		}
		s.store.mu.Unlock()
	}
}

func randomPick(items []string) string {
	if len(items) == 0 {
		return ""
	}
	return items[rand.Intn(len(items))]
}

func randomBotScore(min, max float64) float64 {
	mean := (min + max) / 2
	std := (max - min) / 4
	v := rand.NormFloat64()*std + mean
	if v < min {
		v = min
	}
	if v > max {
		v = max
	}
	return math.Round(v*10000) / 10000
}
