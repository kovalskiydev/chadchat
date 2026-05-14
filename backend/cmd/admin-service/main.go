package main

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"backend/internal/mysqlutil"
)

const maxPageLimit = 100

type Server struct {
	db                      *sql.DB
	adminSecret             string
	authServiceURL          string
	verificationServiceURL  string
	testLabServiceURL       string
	liveChatServiceURL      string
	duelServiceURL          string
	ratingServiceURL        string
	customizationServiceURL string
	mlServiceURL            string
}

type adminUserRow struct {
	RawID              int64
	Nickname           sql.NullString
	Type               string
	Role               string
	VerificationStatus string
	CreatedAt          time.Time
	UpdatedAt          time.Time
	Rating             sql.NullInt64
	PeakRating         sql.NullInt64
	Matches            sql.NullInt64
	Wins               sql.NullInt64
	Losses             sql.NullInt64
	SelectedSoundID    sql.NullString
	SelectedSoundTitle sql.NullString
}

type userListItem struct {
	ID                 string    `json:"id"`
	Nickname           string    `json:"nickname,omitempty"`
	Type               string    `json:"type"`
	Role               string    `json:"role"`
	VerificationStatus string    `json:"verification_status"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
	Rating             int       `json:"rating"`
	PeakRating         int       `json:"peak_rating"`
	Rank               string    `json:"rank"`
	Matches            int       `json:"matches"`
	Wins               int       `json:"wins"`
	Losses             int       `json:"losses"`
	SelectedSoundID    string    `json:"selected_sound_id,omitempty"`
	SelectedSoundTitle string    `json:"selected_sound_title,omitempty"`
}

type dashboardSummary struct {
	TotalUsers           int64   `json:"total_users"`
	TotalRegistered      int64   `json:"total_registered"`
	TotalAnonymous       int64   `json:"total_anonymous"`
	VerifiedUsers        int64   `json:"verified_users"`
	TotalMatches         int64   `json:"total_matches"`
	MatchesToday         int64   `json:"matches_today"`
	AvgRating            float64 `json:"avg_rating"`
	TopRating            int64   `json:"top_rating"`
	TotalChatMessages    int64   `json:"total_chat_messages"`
	ChatMessagesToday    int64   `json:"chat_messages_today"`
	TestLabSessions      int64   `json:"test_lab_sessions"`
	TestLabSessionsToday int64   `json:"test_lab_sessions_today"`
	TotalResultSounds    int64   `json:"total_result_sounds"`
	TotalSoundUnlocks    int64   `json:"total_sound_unlocks"`
}

type healthComponent struct {
	OK         bool   `json:"ok"`
	StatusCode int    `json:"status_code,omitempty"`
	Error      string `json:"error,omitempty"`
}

type userRatingHistoryItem struct {
	Delta     int       `json:"delta"`
	OldRating int       `json:"old_rating"`
	NewRating int       `json:"new_rating"`
	Reason    string    `json:"reason"`
	SourceID  string    `json:"source_id,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type adminMatchItem struct {
	MatchID         string    `json:"match_id"`
	Mode            string    `json:"mode"`
	StartedAt       time.Time `json:"started_at"`
	FinishedAt      time.Time `json:"finished_at"`
	PlayerAID       string    `json:"player_a_id"`
	PlayerANickname string    `json:"player_a_nickname"`
	PlayerARank     string    `json:"player_a_rank"`
	PlayerAScore    float64   `json:"player_a_score"`
	PlayerBRank     string    `json:"player_b_rank"`
	PlayerBID       string    `json:"player_b_id"`
	PlayerBNickname string    `json:"player_b_nickname"`
	PlayerBScore    float64   `json:"player_b_score"`
	Result          string    `json:"result"`
	WinnerID        string    `json:"winner_id,omitempty"`
	RatingDeltaA    int       `json:"rating_delta_a"`
	RatingDeltaB    int       `json:"rating_delta_b"`
}

type verificationSessionItem struct {
	ID          string     `json:"id"`
	BlinkCount  int        `json:"blink_count"`
	TurnLeft    int        `json:"turn_left"`
	TurnRight   int        `json:"turn_right"`
	ExpiresAt   time.Time  `json:"expires_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

type resultSoundAdminItem struct {
	ID            string    `json:"id"`
	Title         string    `json:"title"`
	AudioURL      string    `json:"audio_url"`
	IsDefault     bool      `json:"is_default"`
	IsActive      bool      `json:"is_active"`
	CreatedAt     time.Time `json:"created_at"`
	OwnersCount   int64     `json:"owners_count"`
	SelectedCount int64     `json:"selected_count"`
}

type resultSoundOwner struct {
	UserID     string    `json:"user_id"`
	Nickname   string    `json:"nickname,omitempty"`
	UnlockedAt time.Time `json:"unlocked_at"`
	Source     string    `json:"source"`
	Selected   bool      `json:"selected"`
}

type setUserRoleRequest struct {
	Role string `json:"role"`
}

func main() {
	db, err := mysqlutil.OpenFromEnv()
	if err != nil {
		log.Fatalf("open mysql: %v", err)
	}
	s := &Server{
		db:                      db,
		adminSecret:             envOr("ADMIN_API_SECRET", "dev-admin-secret-change-me"),
		authServiceURL:          envOr("AUTH_SERVICE_URL", "http://localhost:8081"),
		verificationServiceURL:  envOr("VERIFICATION_SERVICE_URL", "http://localhost:8082"),
		testLabServiceURL:       envOr("TEST_LAB_SERVICE_URL", "http://localhost:8083"),
		liveChatServiceURL:      envOr("LIVE_CHAT_SERVICE_URL", "http://localhost:8084"),
		duelServiceURL:          envOr("DUEL_SERVICE_URL", "http://localhost:8085"),
		ratingServiceURL:        envOr("RATING_SERVICE_URL", "http://localhost:8086"),
		customizationServiceURL: envOr("CUSTOMIZATION_SERVICE_URL", "http://localhost:8087"),
		mlServiceURL:            envOr("ML_SERVICE_URL", "http://localhost:8090"),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /admin/dashboard/summary", s.withAdmin(s.handleDashboardSummary))
	mux.HandleFunc("GET /admin/users", s.withAdmin(s.handleUsers))
	mux.HandleFunc("GET /admin/users/{userID}", s.withAdmin(s.handleUserDetail))
	mux.HandleFunc("POST /admin/users/{userID}/role", s.withAdmin(s.handleSetUserRole))
	mux.HandleFunc("GET /admin/users/{userID}/matches", s.withAdmin(s.handleUserMatches))
	mux.HandleFunc("GET /admin/users/{userID}/rating-history", s.withAdmin(s.handleUserRatingHistory))
	mux.HandleFunc("GET /admin/ratings/leaderboard", s.withAdmin(s.handleAdminLeaderboard))
	mux.HandleFunc("GET /admin/ratings/{userID}", s.withAdmin(s.handleAdminUserRating))
	mux.HandleFunc("GET /admin/ratings/{userID}/history", s.withAdmin(s.handleUserRatingHistory))
	mux.HandleFunc("GET /admin/matches", s.withAdmin(s.handleMatches))
	mux.HandleFunc("GET /admin/matches/{matchID}", s.withAdmin(s.handleMatchDetail))
	mux.HandleFunc("GET /admin/matches/stats", s.withAdmin(s.handleMatchStats))
	mux.HandleFunc("GET /admin/verification/stats", s.withAdmin(s.handleVerificationStats))
	mux.HandleFunc("GET /admin/verification/sessions", s.withAdmin(s.handleVerificationSessions))
	mux.HandleFunc("GET /admin/test-lab/stats", s.withAdmin(s.handleTestLabStats))
	mux.HandleFunc("GET /admin/test-lab/sessions", s.withAdmin(s.handleTestLabSessions))
	mux.HandleFunc("GET /admin/chat/stats", s.withAdmin(s.handleChatStats))
	mux.HandleFunc("GET /admin/chat/messages", s.withAdmin(s.handleChatMessages))
	mux.HandleFunc("GET /admin/result-sounds", s.withAdmin(s.handleResultSounds))
	mux.HandleFunc("GET /admin/result-sounds/{soundID}/owners", s.withAdmin(s.handleResultSoundOwners))
	mux.HandleFunc("GET /admin/system/health", s.withAdmin(s.handleSystemHealth))

	addr := ":" + envOr("PORT", "8088")
	log.Printf("admin-service on %s", addr)
	log.Fatal(http.ListenAndServe(addr, withJSON(mux)))
}

func (s *Server) withAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Admin-Secret") != s.adminSecret {
			writeErr(w, http.StatusForbidden, "forbidden")
			return
		}
		next(w, r)
	}
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
		"checks": map[string]string{"mysql": "ok"},
	})
}

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

func (s *Server) loadUserMatches(userID string, r *http.Request) ([]adminMatchItem, string, error) {
	limit, err := parseLimit(r, 20)
	if err != nil {
		return nil, "", err
	}
	offset, err := decodeCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		return nil, "", err
	}
	rows, err := s.db.Query(`
		SELECT match_id, mode, started_at, finished_at, user_id, user_nickname, opponent_rank, my_score, rating_delta, result,
		       opponent_user_id, opponent_nickname, opponent_score
		FROM user_match_history
		WHERE user_id = ?
		ORDER BY finished_at DESC, id DESC
		LIMIT ? OFFSET ?`, userID, limit+1, offset)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	items := []adminMatchItem{}
	for rows.Next() {
		var item adminMatchItem
		var result string
		if err := rows.Scan(&item.MatchID, &item.Mode, &item.StartedAt, &item.FinishedAt, &item.PlayerAID, &item.PlayerANickname, &item.PlayerARank, &item.PlayerAScore, &item.RatingDeltaA, &result, &item.PlayerBID, &item.PlayerBNickname, &item.PlayerBScore); err != nil {
			return nil, "", err
		}
		item.Result = result
		item.WinnerID = item.PlayerAID
		if result != "win" {
			item.WinnerID = ""
		}
		items = append(items, item)
	}
	nextCursor := ""
	if len(items) > limit {
		nextCursor = encodeCursor(offset + limit)
		items = items[:limit]
	}
	return items, nextCursor, nil
}

func rowToUserItem(row adminUserRow) userListItem {
	rating := 1500
	peak := 1500
	if row.Rating.Valid {
		rating = int(row.Rating.Int64)
	}
	if row.PeakRating.Valid {
		peak = int(row.PeakRating.Int64)
	}
	return userListItem{
		ID:                 fmt.Sprintf("u_%d", row.RawID),
		Nickname:           row.Nickname.String,
		Type:               row.Type,
		Role:               normalizeUserRole(row.Role),
		VerificationStatus: row.VerificationStatus,
		CreatedAt:          row.CreatedAt,
		UpdatedAt:          row.UpdatedAt,
		Rating:             rating,
		PeakRating:         peak,
		Rank:               rankFromRating(rating),
		Matches:            int(row.Matches.Int64),
		Wins:               int(row.Wins.Int64),
		Losses:             int(row.Losses.Int64),
		SelectedSoundID:    row.SelectedSoundID.String,
		SelectedSoundTitle: row.SelectedSoundTitle.String,
	}
}

func buildRatingPayload(userID, nickname string, rating, peak int, createdAt, updatedAt time.Time) map[string]any {
	bandName := rankBandFor(rating)
	nextRank := ""
	nextMin := 0
	progress := 100
	floor := 0
	for i, bandItem := range rankBands {
		if bandItem.Name != bandName {
			continue
		}
		floor = bandItem.Min
		if i == 0 {
			floor = 0
		}
		if i < len(rankBands)-1 {
			nextRank = rankBands[i+1].Name
			nextMin = rankBands[i+1].Min
			width := nextMin - bandItem.Min
			if width > 0 {
				progress = (rating - bandItem.Min) * 100 / width
				if progress < 0 {
					progress = 0
				}
				if progress > 100 {
					progress = 100
				}
			}
		}
		break
	}
	return map[string]any{
		"user_id": userID, "nickname": nickname, "rating": rating, "peak_rating": peak, "rank": bandName,
		"next_rank": nextRank, "rank_floor": floor, "next_rank_rating": nextMin, "progress_percent": progress,
		"created_at": createdAt, "updated_at": updatedAt,
	}
}

type rankBand struct {
	Name string
	Min  int
	Max  int
}

var rankBands = []rankBand{
	{"subhuman", -1 << 30, 999},
	{"subfive", 1000, 1299},
	{"ltn", 1300, 1599},
	{"mtn", 1600, 1899},
	{"htn", 1900, 2199},
	{"chadlite", 2200, 2499},
	{"chad", 2500, 2899},
	{"trueadam", 2900, 1 << 30},
}

func rankBandFor(rating int) string {
	for _, band := range rankBands {
		if rating >= band.Min && rating <= band.Max {
			return band.Name
		}
	}
	return rankBands[0].Name
}

func rankFromRating(rating int) string { return rankBandFor(rating) }

func parseLimit(r *http.Request, fallback int) (int, error) {
	limit := fallback
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > maxPageLimit {
			return 0, err
		}
		limit = n
	}
	return limit, nil
}

func encodeCursor(offset int) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(offset)))
}

func decodeCursor(raw string) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, nil
	}
	data, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(string(data))
}

func rawUserID(userID string) (int64, error) {
	if !strings.HasPrefix(userID, "u_") {
		return 0, fmt.Errorf("invalid_user_id")
	}
	return strconv.ParseInt(strings.TrimPrefix(userID, "u_"), 10, 64)
}

func normalizeUserRole(role string) string {
	switch strings.TrimSpace(strings.ToLower(role)) {
	case "user", "admin":
		return strings.TrimSpace(strings.ToLower(role))
	default:
		return ""
	}
}

func periodStart(period string) time.Time {
	now := time.Now().UTC()
	switch period {
	case "today":
		return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	case "week":
		return now.AddDate(0, 0, -7)
	case "season":
		return now.AddDate(0, 0, -90)
	default:
		return time.Time{}
	}
}

func percent(part, total int64) float64 {
	if total == 0 {
		return 0
	}
	return round2(float64(part) * 100 / float64(total))
}

func percentQuery(db *sql.DB, query string, total int64) float64 {
	if total == 0 {
		return 0
	}
	var part int64
	_ = db.QueryRow(query).Scan(&part)
	return percent(part, total)
}

func healthCheck(client *http.Client, rawURL string) (bool, int, string) {
	resp, err := client.Get(rawURL)
	if err != nil {
		return false, 0, err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return false, resp.StatusCode, fmt.Sprintf("unexpected_status_%d", resp.StatusCode)
	}
	return true, resp.StatusCode, ""
}

func handleLoadErr(w http.ResponseWriter, err error) {
	switch {
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "db_error")
	}
}

func appendWhere(where, cond string) string {
	if where == "" {
		return " WHERE " + cond
	}
	return " AND " + cond
}

func normalizeMatchResult(resultA, resultB string) string {
	if resultA == "draw" || resultB == "draw" {
		return "draw"
	}
	if resultA == "win" {
		return "win_a"
	}
	if resultB == "win" {
		return "win_b"
	}
	return "unknown"
}

func winnerID(item adminMatchItem, resultA, resultB string) string {
	if resultA == "win" {
		return item.PlayerAID
	}
	if resultB == "win" {
		return item.PlayerBID
	}
	return ""
}

func round2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
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
