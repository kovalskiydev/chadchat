package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"backend/internal/mysqlutil"
)
func (s *Server) handleDashboardSummary(w http.ResponseWriter, _ *http.Request) {
	var out dashboardSummary
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&out.TotalUsers)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE type = 'registered'`).Scan(&out.TotalRegistered)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE type = 'anonymous'`).Scan(&out.TotalAnonymous)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE verification_status = 'passed'`).Scan(&out.VerifiedUsers)
	_ = s.db.QueryRow(`SELECT COUNT(DISTINCT match_id) FROM user_match_history`).Scan(&out.TotalMatches)
	_ = s.db.QueryRow(`SELECT COUNT(DISTINCT match_id) FROM user_match_history WHERE finished_at >= UTC_DATE()`).Scan(&out.MatchesToday)
	_ = s.db.QueryRow(`SELECT COALESCE(AVG(rating), 0) FROM user_ratings`).Scan(&out.AvgRating)
	_ = s.db.QueryRow(`SELECT COALESCE(MAX(rating), 0) FROM user_ratings`).Scan(&out.TopRating)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM live_chat_messages`).Scan(&out.TotalChatMessages)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM live_chat_messages WHERE created_at >= UTC_DATE()`).Scan(&out.ChatMessagesToday)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM test_lab_sessions`).Scan(&out.TestLabSessions)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM test_lab_sessions WHERE started_at >= UTC_DATE()`).Scan(&out.TestLabSessionsToday)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM result_sounds`).Scan(&out.TotalResultSounds)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM user_result_sounds`).Scan(&out.TotalSoundUnlocks)
	writeJSON(w, http.StatusOK, map[string]any{"summary": out})
}

func (s *Server) handleUsers(w http.ResponseWriter, r *http.Request) {
	limit, err := parseLimit(r, 20)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_limit")
		return
	}
	offset, err := decodeCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_cursor")
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("query"))
	userType := strings.TrimSpace(r.URL.Query().Get("type"))
	verified := strings.TrimSpace(r.URL.Query().Get("verified"))

	args := []any{}
	where := []string{"1=1"}
	if query != "" {
		where = append(where, "(u.nickname LIKE ? OR CONCAT('u_', u.id) LIKE ?)")
		args = append(args, "%"+query+"%", "%"+query+"%")
	}
	if userType != "" {
		where = append(where, "u.type = ?")
		args = append(args, userType)
	}
	if verified != "" {
		if verified == "true" {
			where = append(where, "u.verification_status = 'passed'")
		} else if verified == "false" {
			where = append(where, "u.verification_status <> 'passed'")
		}
	}

	sqlQuery := fmt.Sprintf(`
		SELECT u.id, u.nickname, u.type, u.verification_status, u.created_at, u.updated_at,
		       u.role,
		       ur.rating, ur.peak_rating,
		       COALESCE(stats.matches, 0), COALESCE(stats.wins, 0), COALESCE(stats.losses, 0),
		       us.selected_sound_id, rs.title
		FROM users u
		LEFT JOIN user_ratings ur ON ur.user_id = CONCAT('u_', u.id)
		LEFT JOIN (
			SELECT user_id,
			       COUNT(*) AS matches,
			       SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins,
			       SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) AS losses
			FROM user_match_history
			GROUP BY user_id
		) stats ON stats.user_id = CONCAT('u_', u.id)
		LEFT JOIN user_result_sound_settings us ON us.user_id = CONCAT('u_', u.id)
		LEFT JOIN result_sounds rs ON rs.id = us.selected_sound_id
		WHERE %s
		ORDER BY u.created_at DESC, u.id DESC
		LIMIT ? OFFSET ?`, strings.Join(where, " AND "))
	args = append(args, limit+1, offset)

	rows, err := s.db.Query(sqlQuery, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer rows.Close()

	items := make([]userListItem, 0, limit+1)
	for rows.Next() {
		var row adminUserRow
		if err := rows.Scan(
			&row.RawID, &row.Nickname, &row.Type, &row.VerificationStatus, &row.CreatedAt, &row.UpdatedAt,
			&row.Role,
			&row.Rating, &row.PeakRating, &row.Matches, &row.Wins, &row.Losses, &row.SelectedSoundID, &row.SelectedSoundTitle,
		); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		item := rowToUserItem(row)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	nextCursor := ""
	if len(items) > limit {
		nextCursor = encodeCursor(offset + limit)
		items = items[:limit]
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": items, "next_cursor": nextCursor})
}

func (s *Server) handleUserDetail(w http.ResponseWriter, r *http.Request) {
	userID := strings.TrimSpace(r.PathValue("userID"))
	rawID, err := rawUserID(userID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_user_id")
		return
	}
	row := adminUserRow{}
	err = s.db.QueryRow(`
		SELECT u.id, u.nickname, u.type, u.verification_status, u.created_at, u.updated_at,
		       u.role,
		       ur.rating, ur.peak_rating,
		       COALESCE(stats.matches, 0), COALESCE(stats.wins, 0), COALESCE(stats.losses, 0),
		       us.selected_sound_id, rs.title
		FROM users u
		LEFT JOIN user_ratings ur ON ur.user_id = CONCAT('u_', u.id)
		LEFT JOIN (
			SELECT user_id,
			       COUNT(*) AS matches,
			       SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins,
			       SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) AS losses
			FROM user_match_history
			GROUP BY user_id
		) stats ON stats.user_id = CONCAT('u_', u.id)
		LEFT JOIN user_result_sound_settings us ON us.user_id = CONCAT('u_', u.id)
		LEFT JOIN result_sounds rs ON rs.id = us.selected_sound_id
		WHERE u.id = ?`, rawID).Scan(
		&row.RawID, &row.Nickname, &row.Type, &row.VerificationStatus, &row.CreatedAt, &row.UpdatedAt,
		&row.Role,
		&row.Rating, &row.PeakRating, &row.Matches, &row.Wins, &row.Losses, &row.SelectedSoundID, &row.SelectedSoundTitle,
	)
	if err == sql.ErrNoRows {
		writeErr(w, http.StatusNotFound, "user_not_found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": rowToUserItem(row)})
}

func (s *Server) handleSetUserRole(w http.ResponseWriter, r *http.Request) {
	userID := strings.TrimSpace(r.PathValue("userID"))
	rawID, err := rawUserID(userID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_user_id")
		return
	}
	var req setUserRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	role := normalizeUserRole(req.Role)
	if role == "" {
		writeErr(w, http.StatusBadRequest, "invalid_role")
		return
	}
	result, err := s.db.Exec(`UPDATE users SET role = ?, updated_at = ? WHERE id = ?`, role, time.Now().UTC(), rawID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		writeErr(w, http.StatusNotFound, "user_not_found")
		return
	}
	row := adminUserRow{}
	err = s.db.QueryRow(`
		SELECT u.id, u.nickname, u.type, u.verification_status, u.created_at, u.updated_at,
		       u.role,
		       ur.rating, ur.peak_rating,
		       COALESCE(stats.matches, 0), COALESCE(stats.wins, 0), COALESCE(stats.losses, 0),
		       us.selected_sound_id, rs.title
		FROM users u
		LEFT JOIN user_ratings ur ON ur.user_id = CONCAT('u_', u.id)
		LEFT JOIN (
			SELECT user_id,
			       COUNT(*) AS matches,
			       SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins,
			       SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) AS losses
			FROM user_match_history
			GROUP BY user_id
		) stats ON stats.user_id = CONCAT('u_', u.id)
		LEFT JOIN user_result_sound_settings us ON us.user_id = CONCAT('u_', u.id)
		LEFT JOIN result_sounds rs ON rs.id = us.selected_sound_id
		WHERE u.id = ?`, rawID).Scan(
		&row.RawID, &row.Nickname, &row.Type, &row.VerificationStatus, &row.CreatedAt, &row.UpdatedAt,
		&row.Role,
		&row.Rating, &row.PeakRating, &row.Matches, &row.Wins, &row.Losses, &row.SelectedSoundID, &row.SelectedSoundTitle,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": rowToUserItem(row)})
}

func (s *Server) handleUserMatches(w http.ResponseWriter, r *http.Request) {
	userID := strings.TrimSpace(r.PathValue("userID"))
	items, nextCursor, err := s.loadUserMatches(userID, r)
	if err != nil {
		handleLoadErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"matches": items, "next_cursor": nextCursor})
}

func (s *Server) handleUserRatingHistory(w http.ResponseWriter, r *http.Request) {
	userID := strings.TrimSpace(r.PathValue("userID"))
	limit, err := parseLimit(r, 50)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_limit")
		return
	}
	rows, err := s.db.Query(
		`SELECT delta, old_rating, new_rating, reason, COALESCE(source_id, ''), created_at
		 FROM rating_history
		 WHERE user_id = ?
		 ORDER BY created_at DESC, id DESC
		 LIMIT ?`,
		userID, limit,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer rows.Close()
	items := make([]userRatingHistoryItem, 0, limit)
	for rows.Next() {
		var item userRatingHistoryItem
		if err := rows.Scan(&item.Delta, &item.OldRating, &item.NewRating, &item.Reason, &item.SourceID, &item.CreatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		items = append(items, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"history": items})
}

func (s *Server) handleAdminLeaderboard(w http.ResponseWriter, r *http.Request) {
	limit, err := parseLimit(r, 50)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_limit")
		return
	}
	offset, err := decodeCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_cursor")
		return
	}
	rows, err := s.db.Query(`
		SELECT ur.user_id, COALESCE(u.nickname, ''), ur.rating, ur.peak_rating, ur.updated_at
		FROM user_ratings ur
		LEFT JOIN users u ON u.id = CAST(SUBSTRING(ur.user_id, 3) AS UNSIGNED)
		ORDER BY ur.rating DESC, ur.updated_at ASC, ur.user_id ASC
		LIMIT ? OFFSET ?`, limit+1, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer rows.Close()
	type item struct {
		Position   int       `json:"position"`
		UserID     string    `json:"user_id"`
		Nickname   string    `json:"nickname,omitempty"`
		Rating     int       `json:"rating"`
		PeakRating int       `json:"peak_rating"`
		Rank       string    `json:"rank"`
		UpdatedAt  time.Time `json:"updated_at"`
	}
	items := make([]item, 0, limit+1)
	pos := offset + 1
	for rows.Next() {
		var i item
		if err := rows.Scan(&i.UserID, &i.Nickname, &i.Rating, &i.PeakRating, &i.UpdatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		i.Position = pos
		i.Rank = rankFromRating(i.Rating)
		pos++
		items = append(items, i)
	}
	nextCursor := ""
	if len(items) > limit {
		nextCursor = encodeCursor(offset + limit)
		items = items[:limit]
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": items, "next_cursor": nextCursor})
}

func (s *Server) handleAdminUserRating(w http.ResponseWriter, r *http.Request) {
	userID := strings.TrimSpace(r.PathValue("userID"))
	var nickname sql.NullString
	var rating, peak int
	var createdAt, updatedAt time.Time
	err := s.db.QueryRow(`
		SELECT COALESCE(u.nickname, ''), ur.rating, ur.peak_rating, ur.created_at, ur.updated_at
		FROM user_ratings ur
		LEFT JOIN users u ON u.id = CAST(SUBSTRING(ur.user_id, 3) AS UNSIGNED)
		WHERE ur.user_id = ?`, userID).Scan(&nickname, &rating, &peak, &createdAt, &updatedAt)
	if err == sql.ErrNoRows {
		writeErr(w, http.StatusNotFound, "rating_not_found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"rating": buildRatingPayload(userID, nickname.String, rating, peak, createdAt, updatedAt),
	})
}

func (s *Server) handleMatches(w http.ResponseWriter, r *http.Request) {
	limit, err := parseLimit(r, 20)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_limit")
		return
	}
	offset, err := decodeCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_cursor")
		return
	}
	rows, err := s.db.Query(`
		SELECT a.match_id, a.mode, a.started_at, a.finished_at,
		       a.user_id, a.user_nickname, a.opponent_rank, a.my_score, a.rating_delta, a.result,
		       b.user_id, b.user_nickname, b.opponent_rank, b.my_score, b.rating_delta, b.result
		FROM user_match_history a
		JOIN user_match_history b
		  ON b.match_id = a.match_id AND b.user_id = a.opponent_user_id
		WHERE a.user_id < b.user_id
		ORDER BY a.finished_at DESC
		LIMIT ? OFFSET ?`, limit+1, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer rows.Close()
	items := make([]adminMatchItem, 0, limit+1)
	for rows.Next() {
		var item adminMatchItem
		var resultA, resultB string
		if err := rows.Scan(
			&item.MatchID, &item.Mode, &item.StartedAt, &item.FinishedAt,
			&item.PlayerAID, &item.PlayerANickname, &item.PlayerARank, &item.PlayerAScore, &item.RatingDeltaA, &resultA,
			&item.PlayerBID, &item.PlayerBNickname, &item.PlayerBRank, &item.PlayerBScore, &item.RatingDeltaB, &resultB,
		); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		item.Result = normalizeMatchResult(resultA, resultB)
		item.WinnerID = winnerID(item, resultA, resultB)
		items = append(items, item)
	}
	nextCursor := ""
	if len(items) > limit {
		nextCursor = encodeCursor(offset + limit)
		items = items[:limit]
	}
	writeJSON(w, http.StatusOK, map[string]any{"matches": items, "next_cursor": nextCursor})
}

func (s *Server) handleMatchDetail(w http.ResponseWriter, r *http.Request) {
	matchID := strings.TrimSpace(r.PathValue("matchID"))
	rows, err := s.db.Query(`
		SELECT user_id, user_nickname, opponent_rank, my_score, rating_delta, result, started_at, finished_at, mode
		FROM user_match_history WHERE match_id = ? ORDER BY user_id ASC`, matchID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer rows.Close()
	type matchEntry struct {
		UserID       string    `json:"user_id"`
		Nickname     string    `json:"nickname"`
		OpponentRank string    `json:"opponent_rank"`
		Score        float64   `json:"score"`
		RatingDelta  int       `json:"rating_delta"`
		Result       string    `json:"result"`
		StartedAt    time.Time `json:"started_at"`
		FinishedAt   time.Time `json:"finished_at"`
		Mode         string    `json:"mode"`
	}
	var items []matchEntry
	for rows.Next() {
		var row matchEntry
		if err := rows.Scan(&row.UserID, &row.Nickname, &row.OpponentRank, &row.Score, &row.RatingDelta, &row.Result, &row.StartedAt, &row.FinishedAt, &row.Mode); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		items = append(items, row)
	}
	if len(items) == 0 {
		writeErr(w, http.StatusNotFound, "match_not_found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"match": map[string]any{"match_id": matchID, "entries": items}})
}

func (s *Server) handleMatchStats(w http.ResponseWriter, r *http.Request) {
	start := periodStart(strings.TrimSpace(r.URL.Query().Get("period")))
	args := []any{}
	where := ""
	if !start.IsZero() {
		where = " WHERE finished_at >= ?"
		args = append(args, start)
	}
	var total, disconnects, draws int64
	var avgScore, avgDuration sql.NullFloat64
	_ = s.db.QueryRow(
		`SELECT COUNT(DISTINCT match_id),
		        COALESCE(AVG((my_score + opponent_score)/2), 0),
		        COALESCE(AVG(TIMESTAMPDIFF(SECOND, started_at, finished_at)), 0)
		   FROM user_match_history`+where, args...).Scan(&total, &avgScore, &avgDuration)
	_ = s.db.QueryRow(
		`SELECT COUNT(DISTINCT match_id) FROM user_match_history`+where+appendWhere(where, " result = 'draw'"), args...).Scan(&draws)
	_ = s.db.QueryRow(
		`SELECT COUNT(DISTINCT match_id) FROM user_match_history`+where+appendWhere(where, " result IN ('win','loss') AND EXISTS (SELECT 1 FROM rating_history rh WHERE rh.source_id = user_match_history.match_id AND rh.reason = 'duel_disconnect')"), args...).Scan(&disconnects)
	writeJSON(w, http.StatusOK, map[string]any{
		"stats": map[string]any{
			"matches":              total,
			"draws":                draws,
			"disconnect_finishes":  disconnects,
			"average_score":        round2(avgScore.Float64),
			"average_duration_sec": int(avgDuration.Float64),
		},
	})
}

func (s *Server) handleVerificationStats(w http.ResponseWriter, _ *http.Request) {
	var totalSessions, completed, totalTokens, usedTokens int64
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM verification_sessions`).Scan(&totalSessions)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM verification_sessions WHERE completed_at IS NOT NULL`).Scan(&completed)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM verification_tokens`).Scan(&totalTokens)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM verification_tokens WHERE used_at IS NOT NULL`).Scan(&usedTokens)
	writeJSON(w, http.StatusOK, map[string]any{
		"stats": map[string]any{
			"total_sessions":     totalSessions,
			"completed_sessions": completed,
			"pass_rate":          percent(completed, totalSessions),
			"issued_tokens":      totalTokens,
			"used_tokens":        usedTokens,
			"token_consume_rate": percent(usedTokens, totalTokens),
		},
	})
}

func (s *Server) handleVerificationSessions(w http.ResponseWriter, r *http.Request) {
	limit, err := parseLimit(r, 50)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_limit")
		return
	}
	rows, err := s.db.Query(
		`SELECT id, blink_count, turn_left, turn_right, expires_at, completed_at, created_at
		 FROM verification_sessions ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer rows.Close()
	items := make([]verificationSessionItem, 0, limit)
	for rows.Next() {
		var item verificationSessionItem
		var completed sql.NullTime
		if err := rows.Scan(&item.ID, &item.BlinkCount, &item.TurnLeft, &item.TurnRight, &item.ExpiresAt, &completed, &item.CreatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		if completed.Valid {
			item.CompletedAt = &completed.Time
		}
		items = append(items, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": items})
}

func (s *Server) handleTestLabStats(w http.ResponseWriter, _ *http.Request) {
	var sessions, sessionsToday, samples int64
	var avgFinal sql.NullFloat64
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM test_lab_sessions`).Scan(&sessions)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM test_lab_sessions WHERE started_at >= UTC_DATE()`).Scan(&sessionsToday)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM test_lab_samples`).Scan(&samples)
	_ = s.db.QueryRow(`SELECT COALESCE(AVG(final_average), 0) FROM test_lab_sessions WHERE final_average IS NOT NULL`).Scan(&avgFinal)
	writeJSON(w, http.StatusOK, map[string]any{
		"stats": map[string]any{
			"total_sessions":      sessions,
			"sessions_today":      sessionsToday,
			"total_samples":       samples,
			"average_final_score": round2(avgFinal.Float64),
			"completion_rate":     percentQuery(s.db, `SELECT COUNT(*) FROM test_lab_sessions WHERE finished_at IS NOT NULL`, sessions),
		},
	})
}

func (s *Server) handleTestLabSessions(w http.ResponseWriter, r *http.Request) {
	limit, err := parseLimit(r, 50)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_limit")
		return
	}
	rows, err := s.db.Query(`
		SELECT s.id, s.room_id, r.owner_id, s.started_at, s.ends_at, s.finished_at, s.final_average,
		       COALESCE(sample_counts.cnt, 0)
		FROM test_lab_sessions s
		JOIN test_lab_rooms r ON r.id = s.room_id
		LEFT JOIN (
			SELECT session_id, COUNT(*) AS cnt FROM test_lab_samples GROUP BY session_id
		) sample_counts ON sample_counts.session_id = s.id
		ORDER BY s.started_at DESC LIMIT ?`, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer rows.Close()
	type item struct {
		ID           string     `json:"id"`
		RoomID       string     `json:"room_id"`
		OwnerID      string     `json:"owner_id"`
		StartedAt    time.Time  `json:"started_at"`
		EndsAt       time.Time  `json:"ends_at"`
		FinishedAt   *time.Time `json:"finished_at,omitempty"`
		FinalAverage *float64   `json:"final_average,omitempty"`
		SamplesCount int64      `json:"samples_count"`
	}
	items := make([]item, 0, limit)
	for rows.Next() {
		var it item
		var finished sql.NullTime
		var avg sql.NullFloat64
		if err := rows.Scan(&it.ID, &it.RoomID, &it.OwnerID, &it.StartedAt, &it.EndsAt, &finished, &avg, &it.SamplesCount); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		if finished.Valid {
			it.FinishedAt = &finished.Time
		}
		if avg.Valid {
			v := round2(avg.Float64)
			it.FinalAverage = &v
		}
		items = append(items, it)
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": items})
}

func (s *Server) handleChatStats(w http.ResponseWriter, _ *http.Request) {
	var total, today int64
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM live_chat_messages`).Scan(&total)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM live_chat_messages WHERE created_at >= UTC_DATE()`).Scan(&today)
	rows, _ := s.db.Query(`
		SELECT sender_id, sender_nickname, COUNT(*) AS cnt
		FROM live_chat_messages
		GROUP BY sender_id, sender_nickname
		ORDER BY cnt DESC
		LIMIT 5`)
	defer func() {
		if rows != nil {
			rows.Close()
		}
	}()
	top := []map[string]any{}
	if rows != nil {
		for rows.Next() {
			var userID, nickname string
			var count int64
			if rows.Scan(&userID, &nickname, &count) == nil {
				top = append(top, map[string]any{"user_id": userID, "nickname": nickname, "messages": count})
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"stats": map[string]any{
		"total_messages": total,
		"messages_today": today,
		"top_senders":    top,
	}})
}

func (s *Server) handleChatMessages(w http.ResponseWriter, r *http.Request) {
	limit, err := parseLimit(r, 100)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_limit")
		return
	}
	rows, err := s.db.Query(`SELECT id, sender_id, sender_nickname, text, created_at FROM live_chat_messages ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer rows.Close()
	type item struct {
		ID             string    `json:"id"`
		SenderID       string    `json:"sender_id"`
		SenderNickname string    `json:"sender_nickname"`
		Text           string    `json:"text"`
		CreatedAt      time.Time `json:"created_at"`
	}
	items := []item{}
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.ID, &it.SenderID, &it.SenderNickname, &it.Text, &it.CreatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		items = append(items, it)
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": items})
}

func (s *Server) handleResultSounds(w http.ResponseWriter, _ *http.Request) {
	rows, err := s.db.Query(`
		SELECT rs.id, rs.title, rs.audio_url, rs.is_default, rs.is_active, rs.created_at,
		       COALESCE(owners.cnt, 0), COALESCE(selected.cnt, 0)
		FROM result_sounds rs
		LEFT JOIN (
			SELECT sound_id, COUNT(*) AS cnt FROM user_result_sounds GROUP BY sound_id
		) owners ON owners.sound_id = rs.id
		LEFT JOIN (
			SELECT selected_sound_id, COUNT(*) AS cnt FROM user_result_sound_settings GROUP BY selected_sound_id
		) selected ON selected.selected_sound_id = rs.id
		ORDER BY rs.created_at DESC`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer rows.Close()
	items := []resultSoundAdminItem{}
	for rows.Next() {
		var it resultSoundAdminItem
		if err := rows.Scan(&it.ID, &it.Title, &it.AudioURL, &it.IsDefault, &it.IsActive, &it.CreatedAt, &it.OwnersCount, &it.SelectedCount); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		items = append(items, it)
	}
	writeJSON(w, http.StatusOK, map[string]any{"sounds": items})
}

func (s *Server) handleResultSoundOwners(w http.ResponseWriter, r *http.Request) {
	soundID := strings.TrimSpace(r.PathValue("soundID"))
	rows, err := s.db.Query(`
		SELECT urs.user_id, COALESCE(u.nickname, ''), urs.unlocked_at, urs.source,
		       CASE WHEN us.selected_sound_id = urs.sound_id THEN 1 ELSE 0 END AS selected
		FROM user_result_sounds urs
		LEFT JOIN users u ON u.id = CAST(SUBSTRING(urs.user_id, 3) AS UNSIGNED)
		LEFT JOIN user_result_sound_settings us ON us.user_id = urs.user_id
		WHERE urs.sound_id = ?
		ORDER BY urs.unlocked_at DESC`, soundID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer rows.Close()
	items := []resultSoundOwner{}
	for rows.Next() {
		var it resultSoundOwner
		if err := rows.Scan(&it.UserID, &it.Nickname, &it.UnlockedAt, &it.Source, &it.Selected); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		items = append(items, it)
	}
	writeJSON(w, http.StatusOK, map[string]any{"owners": items})
}

func (s *Server) handleSystemHealth(w http.ResponseWriter, _ *http.Request) {
	client := &http.Client{Timeout: 2 * time.Second}
	services := map[string]string{
		"auth":          s.authServiceURL,
		"verification":  s.verificationServiceURL,
		"test_lab":      s.testLabServiceURL,
		"live_chat":     s.liveChatServiceURL,
		"duel":          s.duelServiceURL,
		"rating":        s.ratingServiceURL,
		"customization": s.customizationServiceURL,
		"ml":            s.mlServiceURL,
	}
	checks := map[string]healthComponent{}
	allOK := true
	for name, raw := range services {
		ok, code, errText := healthCheck(client, strings.TrimRight(raw, "/")+"/health")
		checks[name] = healthComponent{OK: ok, StatusCode: code, Error: errText}
		if !ok {
			allOK = false
		}
	}
	mysqlOK := mysqlutil.Ping(s.db) == nil
	checks["mysql"] = healthComponent{OK: mysqlOK, StatusCode: 200}
	if !mysqlOK {
		checks["mysql"] = healthComponent{OK: false, Error: "mysql_unavailable"}
		allOK = false
	}
	status := http.StatusOK
	if !allOK {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, map[string]any{"ok": allOK, "services": checks})
}
