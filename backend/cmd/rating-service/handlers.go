package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"backend/internal/httputil"
)

func (s *Server) handleMyRating(w http.ResponseWriter, _ *http.Request, user authUser) {
	profile, err := s.ensureAndLoadRating(user.ID, user.Nickname)
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"rating": profile})
}

func (s *Server) handleUserRating(w http.ResponseWriter, r *http.Request, _ authUser) {
	userID := r.PathValue("userID")
	if userID == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_user_id")
		return
	}
	profile, err := s.ensureAndLoadRating(userID, "")
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"rating": profile})
}

func (s *Server) handleLeaderboard(w http.ResponseWriter, r *http.Request, _ authUser) {
	limit, err := parseLimit(r, defaultLeaderboard)
	if err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_limit")
		return
	}
	offset, err := decodeCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_cursor")
		return
	}

	rows, err := s.db.Query(
		`SELECT ur.user_id, COALESCE(u.nickname, ''), ur.rating, ur.peak_rating, ur.updated_at
		 FROM user_ratings ur
		 LEFT JOIN users u ON u.id = CAST(SUBSTRING(ur.user_id, 3) AS UNSIGNED)
		 ORDER BY ur.rating DESC, ur.updated_at ASC, ur.user_id ASC
		 LIMIT ? OFFSET ?`,
		limit+1, offset,
	)
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer rows.Close()

	entries := make([]leaderboardEntry, 0, limit+1)
	position := offset + 1
	for rows.Next() {
		var entry leaderboardEntry
		if err := rows.Scan(&entry.UserID, &entry.Nickname, &entry.Rating, &entry.PeakRating, &entry.UpdatedAt); err != nil {
			httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		entry.Rank = rankFromRating(entry.Rating).Name
		entry.Position = position
		position++
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	nextCursor := ""
	if len(entries) > limit {
		nextCursor = encodeCursor(offset + limit)
		entries = entries[:limit]
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"entries":     entries,
		"next_cursor": nextCursor,
	})
}

func (s *Server) handleStatsSummary(w http.ResponseWriter, _ *http.Request, user authUser) {
	profile, summary, err := s.loadSummary(user.ID, user.Nickname, time.Time{}, time.Time{})
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"summary": buildSummaryResponse(profile, summary)})
}

func (s *Server) handleStatsPeriod(w http.ResponseWriter, r *http.Request, user authUser) {
	start, prevStart, prevEnd, err := parsePeriodWindow(strings.TrimSpace(r.URL.Query().Get("period")), time.Now().UTC())
	if err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_period")
		return
	}
	end := time.Now().UTC()

	profile, current, err := s.loadSummary(user.ID, user.Nickname, start, end)
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	previousProfile, previous, err := s.loadSummary(user.ID, user.Nickname, prevStart, prevEnd)
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	cur := buildSummaryResponse(profile, current)
	prev := buildSummaryResponse(previousProfile, previous)
	resp := statsPeriodResponse{
		statsSummary:      cur,
		RatingTrend:       float64(cur.Rating - prev.Rating),
		PeakTrend:         float64(cur.PeakRating - prev.PeakRating),
		MatchesTrend:      float64(cur.Matches - prev.Matches),
		WinsTrend:         float64(cur.Wins - prev.Wins),
		LossesTrend:       float64(cur.Losses - prev.Losses),
		WinRateTrend:      round2(cur.WinRate - prev.WinRate),
		AverageScoreTrend: round2(cur.AverageScore - prev.AverageScore),
		AvgGainTrend:      round2(cur.AvgGain - prev.AvgGain),
		AvgLossTrend:      round2(cur.AvgLoss - prev.AvgLoss),
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"period": resp})
}

func (s *Server) handleStatsHistory(w http.ResponseWriter, r *http.Request, user authUser) {
	now := time.Now().UTC()
	start, _, _, err := parsePeriodWindow(strings.TrimSpace(r.URL.Query().Get("period")), now)
	if err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_period")
		return
	}
	interval, err := parseInterval(strings.TrimSpace(r.URL.Query().Get("interval")))
	if err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_interval")
		return
	}
	points, err := s.loadHistoryPoints(user.ID, start, now, interval)
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"points": points})
}

func (s *Server) handleMyMatches(w http.ResponseWriter, r *http.Request, user authUser) {
	limit, err := parseLimit(r, 20)
	if err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_limit")
		return
	}
	offset, err := decodeCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_cursor")
		return
	}
	rows, err := s.db.Query(
		`SELECT match_id, mode, started_at, finished_at, result, rating_delta, my_score, opponent_score,
		        opponent_user_id, opponent_nickname, opponent_rank
		 FROM user_match_history
		 WHERE user_id = ?
		 ORDER BY finished_at DESC, id DESC
		 LIMIT ? OFFSET ?`,
		user.ID, limit+1, offset,
	)
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer rows.Close()

	items := make([]matchEntry, 0, limit+1)
	for rows.Next() {
		var item matchEntry
		if err := rows.Scan(
			&item.MatchID, &item.Mode, &item.StartedAt, &item.FinishedAt, &item.Result,
			&item.RatingDelta, &item.MyScore, &item.OpponentScore, &item.OpponentUserID,
			&item.OpponentNickname, &item.OpponentRank,
		); err != nil {
			httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	nextCursor := ""
	if len(items) > limit {
		nextCursor = encodeCursor(offset + limit)
		items = items[:limit]
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"matches":     items,
		"next_cursor": nextCursor,
	})
}

func (s *Server) handleRecentForm(w http.ResponseWriter, r *http.Request, user authUser) {
	count := 5
	if raw := strings.TrimSpace(r.URL.Query().Get("count")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 20 {
			httputil.WriteErr(w, http.StatusBadRequest, "invalid_count")
			return
		}
		count = parsed
	}
	rows, err := s.db.Query(
		`SELECT result
		 FROM user_match_history
		 WHERE user_id = ?
		 ORDER BY finished_at DESC, id DESC
		 LIMIT ?`,
		user.ID, count,
	)
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer rows.Close()
	form := make([]string, 0, count)
	for rows.Next() {
		var result string
		if err := rows.Scan(&result); err != nil {
			httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		form = append(form, resultLetter(result))
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"form": form})
}

func (s *Server) handleQueueInfo(w http.ResponseWriter, _ *http.Request, user authUser) {
	lastDelta := 0
	_ = s.db.QueryRow(
		`SELECT rating_delta
		 FROM user_match_history
		 WHERE user_id = ?
		 ORDER BY finished_at DESC, id DESC
		 LIMIT 1`,
		user.ID,
	).Scan(&lastDelta)

	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"queue_info": queueInfo{
			QueueType:            s.queueType,
			EstimatedWaitSec:     0,
			Region:               s.region,
			LastMatchRatingDelta: lastDelta,
		},
	})
}

func (s *Server) handleInternalRecordDuel(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Rating-Internal-Secret") != s.internalSecret {
		httputil.WriteErr(w, http.StatusForbidden, "forbidden")
		return
	}
	var req duelRecordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if err := validateDuelRecord(req); err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.recordDuel(req); err != nil {
		if errors.Is(err, errMatchAlreadyRecorded) {
			httputil.WriteJSON(w, http.StatusOK, map[string]any{"status": "already_recorded"})
			return
		}
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"status": "recorded"})
}

var errMatchAlreadyRecorded = errors.New("match already recorded")

func validateDuelRecord(req duelRecordRequest) error {
	if strings.TrimSpace(req.MatchID) == "" {
		return errors.New("missing_match_id")
	}
	if req.PlayerAID == "" || req.PlayerBID == "" || req.PlayerAID == req.PlayerBID {
		return errors.New("invalid_players")
	}
	if req.FinishedAt.IsZero() {
		req.FinishedAt = time.Now().UTC()
	}
	return nil
}
