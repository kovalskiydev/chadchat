package main

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"backend/internal/mysqlutil"
)

const (
	defaultUserRating  = 1500
	defaultLeaderboard = 50
	maxPageLimit       = 100
	eloKFactor         = 24.0
	defaultQueueType   = "duel"
	defaultRegion      = "global"
)

type Server struct {
	db             *sql.DB
	authServiceURL string
	internalSecret string
	queueType      string
	region         string
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

type RatingProfile struct {
	UserID          string    `json:"user_id"`
	Nickname        string    `json:"nickname,omitempty"`
	Rating          int       `json:"rating"`
	PeakRating      int       `json:"peak_rating"`
	Rank            string    `json:"rank"`
	NextRank        string    `json:"next_rank,omitempty"`
	RankFloor       int       `json:"rank_floor"`
	NextRankRating  int       `json:"next_rank_rating,omitempty"`
	ProgressPercent int       `json:"progress_percent"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type leaderboardEntry struct {
	Position   int       `json:"position"`
	UserID     string    `json:"user_id"`
	Nickname   string    `json:"nickname,omitempty"`
	Rating     int       `json:"rating"`
	PeakRating int       `json:"peak_rating"`
	Rank       string    `json:"rank"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type rankBand struct {
	Name string
	Min  int
	Max  int
}

type duelRecordRequest struct {
	MatchID         string    `json:"match_id"`
	Mode            string    `json:"mode"`
	StartedAt       time.Time `json:"started_at"`
	FinishedAt      time.Time `json:"finished_at"`
	PlayerAID       string    `json:"player_a_id"`
	PlayerANickname string    `json:"player_a_nickname"`
	PlayerAScore    float64   `json:"player_a_score"`
	PlayerBID       string    `json:"player_b_id"`
	PlayerBNickname string    `json:"player_b_nickname"`
	PlayerBScore    float64   `json:"player_b_score"`
	WinnerID        string    `json:"winner_id,omitempty"`
	Reason          string    `json:"reason"`
}

type statsSummary struct {
	Rating          int     `json:"rating"`
	PeakRating      int     `json:"peak_rating"`
	Rank            string  `json:"rank"`
	NextRank        string  `json:"next_rank,omitempty"`
	RankFloor       int     `json:"rank_floor"`
	NextRankRating  int     `json:"next_rank_rating,omitempty"`
	ProgressPercent int     `json:"progress_percent"`
	Wins            int     `json:"wins"`
	Losses          int     `json:"losses"`
	Matches         int     `json:"matches"`
	WinRate         float64 `json:"win_rate"`
	AverageScore    float64 `json:"average_score"`
	AvgGain         float64 `json:"avg_gain"`
	AvgLoss         float64 `json:"avg_loss"`
	Streak          int     `json:"streak"`
}

type statsPeriodResponse struct {
	statsSummary
	RatingTrend       float64 `json:"rating_trend"`
	PeakTrend         float64 `json:"peak_trend"`
	MatchesTrend      float64 `json:"matches_trend"`
	WinsTrend         float64 `json:"wins_trend"`
	LossesTrend       float64 `json:"losses_trend"`
	WinRateTrend      float64 `json:"win_rate_trend"`
	AverageScoreTrend float64 `json:"average_score_trend"`
	AvgGainTrend      float64 `json:"avg_gain_trend"`
	AvgLossTrend      float64 `json:"avg_loss_trend"`
}

type historyPoint struct {
	TS           time.Time `json:"ts"`
	Rating       int       `json:"rating"`
	AverageScore float64   `json:"average_score"`
	Matches      int       `json:"matches"`
}

type matchEntry struct {
	MatchID          string    `json:"match_id"`
	Mode             string    `json:"mode"`
	StartedAt        time.Time `json:"started_at"`
	FinishedAt       time.Time `json:"finished_at"`
	Result           string    `json:"result"`
	RatingDelta      int       `json:"rating_delta"`
	MyScore          float64   `json:"my_score"`
	OpponentScore    float64   `json:"opponent_score"`
	OpponentUserID   string    `json:"opponent_user_id"`
	OpponentNickname string    `json:"opponent_nickname"`
	OpponentRank     string    `json:"opponent_rank"`
}

type queueInfo struct {
	QueueType            string `json:"queue_type"`
	EstimatedWaitSec     int    `json:"estimated_wait_sec"`
	Region               string `json:"region"`
	LastMatchRatingDelta int    `json:"last_match_rating_delta"`
}

type historyAgg struct {
	Matches      int
	ScoreSum     float64
	LastBucketAt time.Time
	Rating       int
}

var rankBands = []rankBand{
	{Name: "subhuman", Min: -1 << 30, Max: 999},
	{Name: "subfive", Min: 1000, Max: 1299},
	{Name: "ltn", Min: 1300, Max: 1599},
	{Name: "mtn", Min: 1600, Max: 1899},
	{Name: "htn", Min: 1900, Max: 2199},
	{Name: "chadlite", Min: 2200, Max: 2499},
	{Name: "chad", Min: 2500, Max: 2899},
	{Name: "trueadam", Min: 2900, Max: 1 << 30},
}

func main() {
	db, err := mysqlutil.OpenFromEnv()
	if err != nil {
		log.Fatalf("open mysql: %v", err)
	}
	if err := mysqlutil.ExecStatements(db, ratingSchema()); err != nil {
		log.Fatalf("rating schema: %v", err)
	}

	s := &Server{
		db:             db,
		authServiceURL: envOr("AUTH_SERVICE_URL", "http://localhost:8081"),
		internalSecret: envOr("RATING_INTERNAL_SECRET", "dev-rating-secret-change-me"),
		queueType:      envOr("DEFAULT_QUEUE_TYPE", defaultQueueType),
		region:         envOr("DEFAULT_REGION", defaultRegion),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /rating/me", s.withAuth(s.handleMyRating))
	mux.HandleFunc("GET /rating/{userID}", s.withAuth(s.handleUserRating))
	mux.HandleFunc("GET /leaderboard", s.withAuth(s.handleLeaderboard))
	mux.HandleFunc("GET /stats/me/summary", s.withAuth(s.handleStatsSummary))
	mux.HandleFunc("GET /stats/me/period", s.withAuth(s.handleStatsPeriod))
	mux.HandleFunc("GET /stats/me/history", s.withAuth(s.handleStatsHistory))
	mux.HandleFunc("GET /stats/me/recent-form", s.withAuth(s.handleRecentForm))
	mux.HandleFunc("GET /stats/me/queue-info", s.withAuth(s.handleQueueInfo))
	mux.HandleFunc("GET /matches/me", s.withAuth(s.handleMyMatches))
	mux.HandleFunc("POST /rating/internal/record-duel", s.handleInternalRecordDuel)

	addr := ":" + envOr("PORT", "8086")
	log.Printf("rating-service on %s", addr)
	log.Fatal(http.ListenAndServe(addr, withJSON(mux)))
}

func ratingSchema() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS user_ratings (
			user_id VARCHAR(64) NOT NULL PRIMARY KEY,
			rating INT NOT NULL,
			peak_rating INT NOT NULL,
			created_at DATETIME(6) NOT NULL,
			updated_at DATETIME(6) NOT NULL,
			INDEX idx_user_ratings_rating (rating DESC),
			INDEX idx_user_ratings_updated_at (updated_at)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS rating_history (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
			user_id VARCHAR(64) NOT NULL,
			delta INT NOT NULL,
			old_rating INT NOT NULL,
			new_rating INT NOT NULL,
			reason VARCHAR(64) NOT NULL,
			source_id VARCHAR(128) NULL,
			created_at DATETIME(6) NOT NULL,
			INDEX idx_rating_history_user_id_created_at (user_id, created_at)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS user_match_history (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
			match_id VARCHAR(128) NOT NULL,
			mode VARCHAR(32) NOT NULL,
			user_id VARCHAR(64) NOT NULL,
			user_nickname VARCHAR(64) NOT NULL,
			opponent_user_id VARCHAR(64) NOT NULL,
			opponent_nickname VARCHAR(64) NOT NULL,
			opponent_rank VARCHAR(32) NOT NULL,
			result VARCHAR(16) NOT NULL,
			rating_delta INT NOT NULL,
			my_score DOUBLE NOT NULL,
			opponent_score DOUBLE NOT NULL,
			started_at DATETIME(6) NOT NULL,
			finished_at DATETIME(6) NOT NULL,
			created_at DATETIME(6) NOT NULL,
			UNIQUE KEY uniq_user_match (match_id, user_id),
			INDEX idx_umh_user_finished (user_id, finished_at DESC),
			INDEX idx_umh_user_started (user_id, started_at DESC)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
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
	return authUser{ID: me.User.ID, Nickname: me.User.Nickname}, nil
}

func (s *Server) handleMyRating(w http.ResponseWriter, _ *http.Request, user authUser) {
	profile, err := s.ensureAndLoadRating(user.ID, user.Nickname)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rating": profile})
}

func (s *Server) handleUserRating(w http.ResponseWriter, r *http.Request, _ authUser) {
	userID := r.PathValue("userID")
	if userID == "" {
		writeErr(w, http.StatusBadRequest, "missing_user_id")
		return
	}
	profile, err := s.ensureAndLoadRating(userID, "")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rating": profile})
}

func (s *Server) handleLeaderboard(w http.ResponseWriter, r *http.Request, _ authUser) {
	limit, err := parseLimit(r, defaultLeaderboard)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_limit")
		return
	}
	offset, err := decodeCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_cursor")
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
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer rows.Close()

	entries := make([]leaderboardEntry, 0, limit+1)
	position := offset + 1
	for rows.Next() {
		var entry leaderboardEntry
		if err := rows.Scan(&entry.UserID, &entry.Nickname, &entry.Rating, &entry.PeakRating, &entry.UpdatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		entry.Rank = rankFromRating(entry.Rating).Name
		entry.Position = position
		position++
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	nextCursor := ""
	if len(entries) > limit {
		nextCursor = encodeCursor(offset + limit)
		entries = entries[:limit]
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"entries":     entries,
		"next_cursor": nextCursor,
	})
}

func (s *Server) handleStatsSummary(w http.ResponseWriter, _ *http.Request, user authUser) {
	profile, summary, err := s.loadSummary(user.ID, user.Nickname, time.Time{}, time.Time{})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"summary": buildSummaryResponse(profile, summary)})
}

func (s *Server) handleStatsPeriod(w http.ResponseWriter, r *http.Request, user authUser) {
	start, prevStart, prevEnd, err := parsePeriodWindow(strings.TrimSpace(r.URL.Query().Get("period")), time.Now().UTC())
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_period")
		return
	}
	end := time.Now().UTC()

	profile, current, err := s.loadSummary(user.ID, user.Nickname, start, end)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	previousProfile, previous, err := s.loadSummary(user.ID, user.Nickname, prevStart, prevEnd)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
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
	writeJSON(w, http.StatusOK, map[string]any{"period": resp})
}

func (s *Server) handleStatsHistory(w http.ResponseWriter, r *http.Request, user authUser) {
	now := time.Now().UTC()
	start, _, _, err := parsePeriodWindow(strings.TrimSpace(r.URL.Query().Get("period")), now)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_period")
		return
	}
	interval, err := parseInterval(strings.TrimSpace(r.URL.Query().Get("interval")))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_interval")
		return
	}
	points, err := s.loadHistoryPoints(user.ID, start, now, interval)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"points": points})
}

func (s *Server) handleMyMatches(w http.ResponseWriter, r *http.Request, user authUser) {
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
		writeErr(w, http.StatusInternalServerError, "db_error")
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
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
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
	writeJSON(w, http.StatusOK, map[string]any{
		"matches":     items,
		"next_cursor": nextCursor,
	})
}

func (s *Server) handleRecentForm(w http.ResponseWriter, r *http.Request, user authUser) {
	count := 5
	if raw := strings.TrimSpace(r.URL.Query().Get("count")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 20 {
			writeErr(w, http.StatusBadRequest, "invalid_count")
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
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer rows.Close()
	form := make([]string, 0, count)
	for rows.Next() {
		var result string
		if err := rows.Scan(&result); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		form = append(form, resultLetter(result))
	}
	writeJSON(w, http.StatusOK, map[string]any{"form": form})
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

	writeJSON(w, http.StatusOK, map[string]any{
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
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	var req duelRecordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if err := validateDuelRecord(req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.recordDuel(req); err != nil {
		if errors.Is(err, errMatchAlreadyRecorded) {
			writeJSON(w, http.StatusOK, map[string]any{"status": "already_recorded"})
			return
		}
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "recorded"})
}

var errMatchAlreadyRecorded = errors.New("match already recorded")

func (s *Server) recordDuel(req duelRecordRequest) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var exists int
	if err := tx.QueryRow(`SELECT 1 FROM user_match_history WHERE match_id = ? LIMIT 1`, req.MatchID).Scan(&exists); err == nil {
		return errMatchAlreadyRecorded
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	profileA, err := s.ensureAndLoadRatingTx(tx, req.PlayerAID, req.PlayerANickname)
	if err != nil {
		return err
	}
	profileB, err := s.ensureAndLoadRatingTx(tx, req.PlayerBID, req.PlayerBNickname)
	if err != nil {
		return err
	}

	scoreA, scoreB := 0.5, 0.5
	resultA, resultB := "draw", "draw"
	if req.WinnerID == req.PlayerAID {
		scoreA, scoreB = 1, 0
		resultA, resultB = "win", "loss"
	} else if req.WinnerID == req.PlayerBID {
		scoreA, scoreB = 0, 1
		resultA, resultB = "loss", "win"
	}

	deltaA, deltaB, newA, newB := applyElo(profileA.Rating, profileB.Rating, scoreA, scoreB)
	peakA := maxInt(profileA.PeakRating, newA)
	peakB := maxInt(profileB.PeakRating, newB)

	if _, err := tx.Exec(
		`UPDATE user_ratings SET rating = ?, peak_rating = ?, updated_at = ? WHERE user_id = ?`,
		newA, peakA, req.FinishedAt, req.PlayerAID,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(
		`UPDATE user_ratings SET rating = ?, peak_rating = ?, updated_at = ? WHERE user_id = ?`,
		newB, peakB, req.FinishedAt, req.PlayerBID,
	); err != nil {
		return err
	}

	if _, err := tx.Exec(
		`INSERT INTO rating_history (user_id, delta, old_rating, new_rating, reason, source_id, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)`,
		req.PlayerAID, deltaA, profileA.Rating, newA, duelReason(req.Reason), req.MatchID, req.FinishedAt,
		req.PlayerBID, deltaB, profileB.Rating, newB, duelReason(req.Reason), req.MatchID, req.FinishedAt,
	); err != nil {
		return err
	}

	opponentRankForA := rankFromRating(newB).Name
	opponentRankForB := rankFromRating(newA).Name
	if _, err := tx.Exec(
		`INSERT INTO user_match_history (
			match_id, mode, user_id, user_nickname, opponent_user_id, opponent_nickname, opponent_rank,
			result, rating_delta, my_score, opponent_score, started_at, finished_at, created_at
		) VALUES
			(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
			(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		req.MatchID, safeMode(req.Mode), req.PlayerAID, req.PlayerANickname, req.PlayerBID, req.PlayerBNickname, opponentRankForA,
		resultA, deltaA, req.PlayerAScore, req.PlayerBScore, req.StartedAt, req.FinishedAt, req.FinishedAt,
		req.MatchID, safeMode(req.Mode), req.PlayerBID, req.PlayerBNickname, req.PlayerAID, req.PlayerANickname, opponentRankForB,
		resultB, deltaB, req.PlayerBScore, req.PlayerAScore, req.StartedAt, req.FinishedAt, req.FinishedAt,
	); err != nil {
		return err
	}

	return tx.Commit()
}

func (s *Server) loadSummary(userID, nickname string, start, end time.Time) (*RatingProfile, statsSummary, error) {
	profile, err := s.ensureAndLoadRating(userID, nickname)
	if err != nil {
		return nil, statsSummary{}, err
	}
	summary := statsSummary{}

	query := `SELECT result, rating_delta, my_score, finished_at
		FROM user_match_history
		WHERE user_id = ?`
	args := []any{userID}
	if !start.IsZero() {
		query += ` AND finished_at >= ? AND finished_at < ?`
		args = append(args, start, end)
	}
	query += ` ORDER BY finished_at DESC, id DESC`
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, statsSummary{}, err
	}
	defer rows.Close()

	first := true
	scoreSum := 0.0
	gainSum, gainCount := 0, 0
	lossSum, lossCount := 0, 0
	for rows.Next() {
		var result string
		var delta int
		var score float64
		var finishedAt time.Time
		if err := rows.Scan(&result, &delta, &score, &finishedAt); err != nil {
			return nil, statsSummary{}, err
		}
		summary.Matches++
		scoreSum += score
		switch result {
		case "win":
			summary.Wins++
			if delta > 0 {
				gainSum += delta
				gainCount++
			}
		case "loss":
			summary.Losses++
			if delta < 0 {
				lossSum += -delta
				lossCount++
			}
		}
		if first {
			summary.Streak = streakSeed(result)
			first = false
		} else if advanceStreak(summary.Streak, result) {
			if summary.Streak > 0 {
				summary.Streak++
			} else if summary.Streak < 0 {
				summary.Streak--
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, statsSummary{}, err
	}

	if summary.Matches > 0 {
		summary.WinRate = round2(float64(summary.Wins) * 100 / float64(summary.Matches))
		summary.AverageScore = round2(scoreSum / float64(summary.Matches))
	}
	if gainCount > 0 {
		summary.AvgGain = round2(float64(gainSum) / float64(gainCount))
	}
	if lossCount > 0 {
		summary.AvgLoss = round2(float64(lossSum) / float64(lossCount))
	}
	return profile, summary, nil
}

func (s *Server) loadHistoryPoints(userID string, start, end time.Time, interval time.Duration) ([]historyPoint, error) {
	initialRating, err := s.ratingBefore(userID, start)
	if err != nil {
		return nil, err
	}
	matchRows, err := s.db.Query(
		`SELECT finished_at, my_score
		 FROM user_match_history
		 WHERE user_id = ? AND finished_at >= ? AND finished_at < ?
		 ORDER BY finished_at ASC, id ASC`,
		userID, start, end,
	)
	if err != nil {
		return nil, err
	}
	defer matchRows.Close()

	ratingRows, err := s.db.Query(
		`SELECT created_at, new_rating
		 FROM rating_history
		 WHERE user_id = ? AND created_at >= ? AND created_at < ?
		 ORDER BY created_at ASC, id ASC`,
		userID, start, end,
	)
	if err != nil {
		return nil, err
	}
	defer ratingRows.Close()

	buckets := map[time.Time]*historyAgg{}
	for ts := truncateTime(start, interval); ts.Before(end.Add(interval)); ts = ts.Add(interval) {
		buckets[ts] = &historyAgg{Rating: initialRating}
	}
	for matchRows.Next() {
		var finishedAt time.Time
		var score float64
		if err := matchRows.Scan(&finishedAt, &score); err != nil {
			return nil, err
		}
		key := truncateTime(finishedAt, interval)
		b := buckets[key]
		if b == nil {
			b = &historyAgg{Rating: initialRating}
			buckets[key] = b
		}
		b.Matches++
		b.ScoreSum += score
	}
	if err := matchRows.Err(); err != nil {
		return nil, err
	}

	for ratingRows.Next() {
		var createdAt time.Time
		var newRating int
		if err := ratingRows.Scan(&createdAt, &newRating); err != nil {
			return nil, err
		}
		key := truncateTime(createdAt, interval)
		b := buckets[key]
		if b == nil {
			b = &historyAgg{}
			buckets[key] = b
		}
		b.Rating = newRating
	}
	if err := ratingRows.Err(); err != nil {
		return nil, err
	}

	points := make([]historyPoint, 0, len(buckets))
	lastRating := initialRating
	for ts := truncateTime(start, interval); ts.Before(end); ts = ts.Add(interval) {
		b := buckets[ts]
		if b == nil {
			b = &historyAgg{Rating: lastRating}
		}
		if b.Rating == 0 {
			b.Rating = lastRating
		}
		lastRating = b.Rating
		avgScore := 0.0
		if b.Matches > 0 {
			avgScore = round2(b.ScoreSum / float64(b.Matches))
		}
		points = append(points, historyPoint{
			TS:           ts,
			Rating:       b.Rating,
			AverageScore: avgScore,
			Matches:      b.Matches,
		})
	}
	return points, nil
}

func (s *Server) ratingBefore(userID string, start time.Time) (int, error) {
	var rating int
	err := s.db.QueryRow(
		`SELECT new_rating
		 FROM rating_history
		 WHERE user_id = ? AND created_at < ?
		 ORDER BY created_at DESC, id DESC
		 LIMIT 1`,
		userID, start,
	).Scan(&rating)
	if err == nil {
		return rating, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	profile, err := s.ensureAndLoadRating(userID, "")
	if err != nil {
		return 0, err
	}
	return profile.Rating, nil
}

func (s *Server) ensureAndLoadRating(userID, nickname string) (*RatingProfile, error) {
	now := time.Now().UTC()
	_, err := s.db.Exec(
		`INSERT INTO user_ratings (user_id, rating, peak_rating, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE user_id = user_id`,
		userID, defaultUserRating, defaultUserRating, now, now,
	)
	if err != nil {
		return nil, err
	}
	return s.loadRatingProfile(userID, nickname)
}

func (s *Server) ensureAndLoadRatingTx(tx *sql.Tx, userID, nickname string) (*RatingProfile, error) {
	now := time.Now().UTC()
	if _, err := tx.Exec(
		`INSERT INTO user_ratings (user_id, rating, peak_rating, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE user_id = user_id`,
		userID, defaultUserRating, defaultUserRating, now, now,
	); err != nil {
		return nil, err
	}

	profile := &RatingProfile{}
	err := tx.QueryRow(
		`SELECT user_id, rating, peak_rating, created_at, updated_at
		 FROM user_ratings WHERE user_id = ?`,
		userID,
	).Scan(&profile.UserID, &profile.Rating, &profile.PeakRating, &profile.CreatedAt, &profile.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if nickname == "" {
		var nick sql.NullString
		if err := tx.QueryRow(
			`SELECT nickname FROM users WHERE id = CAST(SUBSTRING(?, 3) AS UNSIGNED)`,
			userID,
		).Scan(&nick); err == nil {
			profile.Nickname = nick.String
		}
	} else {
		profile.Nickname = nickname
	}
	applyRankInfo(profile)
	return profile, nil
}

func (s *Server) loadRatingProfile(userID, nickname string) (*RatingProfile, error) {
	profile := &RatingProfile{}
	err := s.db.QueryRow(
		`SELECT user_id, rating, peak_rating, created_at, updated_at
		 FROM user_ratings WHERE user_id = ?`,
		userID,
	).Scan(&profile.UserID, &profile.Rating, &profile.PeakRating, &profile.CreatedAt, &profile.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if nickname == "" {
		var nick sql.NullString
		if err := s.db.QueryRow(
			`SELECT nickname FROM users WHERE id = CAST(SUBSTRING(?, 3) AS UNSIGNED)`,
			userID,
		).Scan(&nick); err == nil {
			profile.Nickname = nick.String
		}
	} else {
		profile.Nickname = nickname
	}
	applyRankInfo(profile)
	return profile, nil
}

func rankFromRating(rating int) rankBand {
	for _, band := range rankBands {
		if rating >= band.Min && rating <= band.Max {
			return band
		}
	}
	return rankBands[0]
}

func applyRankInfo(profile *RatingProfile) {
	for i, band := range rankBands {
		if profile.Rating < band.Min || profile.Rating > band.Max {
			continue
		}
		profile.Rank = band.Name
		profile.RankFloor = band.Min
		if i == 0 {
			profile.RankFloor = 0
		}
		if i == len(rankBands)-1 {
			profile.NextRank = ""
			profile.NextRankRating = 0
			profile.ProgressPercent = 100
			return
		}
		next := rankBands[i+1]
		profile.NextRank = next.Name
		profile.NextRankRating = next.Min
		width := next.Min - band.Min
		if width <= 0 {
			profile.ProgressPercent = 0
			return
		}
		progress := (profile.Rating - band.Min) * 100 / width
		if progress < 0 {
			progress = 0
		}
		if progress > 100 {
			progress = 100
		}
		profile.ProgressPercent = progress
		return
	}
}

func buildSummaryResponse(profile *RatingProfile, summary statsSummary) statsSummary {
	summary.Rating = profile.Rating
	summary.PeakRating = profile.PeakRating
	summary.Rank = profile.Rank
	summary.NextRank = profile.NextRank
	summary.RankFloor = profile.RankFloor
	summary.NextRankRating = profile.NextRankRating
	summary.ProgressPercent = profile.ProgressPercent
	return summary
}

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

func parseLimit(r *http.Request, fallback int) (int, error) {
	limit := fallback
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > maxPageLimit {
			return 0, errors.New("invalid_limit")
		}
		limit = parsed
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
	offset, err := strconv.Atoi(string(data))
	if err != nil || offset < 0 {
		return 0, errors.New("invalid_cursor")
	}
	return offset, nil
}

func parsePeriodWindow(period string, now time.Time) (start, prevStart, prevEnd time.Time, err error) {
	switch period {
	case "", "season":
		start = now.AddDate(0, 0, -90)
	case "today":
		start = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	case "week":
		start = now.AddDate(0, 0, -7)
	default:
		return time.Time{}, time.Time{}, time.Time{}, errors.New("invalid_period")
	}
	duration := now.Sub(start)
	prevEnd = start
	prevStart = start.Add(-duration)
	return start, prevStart, prevEnd, nil
}

func parseInterval(raw string) (time.Duration, error) {
	switch raw {
	case "", "day":
		return 24 * time.Hour, nil
	case "hour":
		return time.Hour, nil
	default:
		return 0, errors.New("invalid_interval")
	}
}

func streakSeed(result string) int {
	switch result {
	case "win":
		return 1
	case "loss":
		return -1
	default:
		return 0
	}
}

func advanceStreak(current int, result string) bool {
	if current > 0 {
		return result == "win"
	}
	if current < 0 {
		return result == "loss"
	}
	return false
}

func resultLetter(result string) string {
	switch result {
	case "win":
		return "W"
	case "loss":
		return "L"
	default:
		return "D"
	}
}

func truncateTime(ts time.Time, interval time.Duration) time.Time {
	if interval == time.Hour {
		return ts.UTC().Truncate(time.Hour)
	}
	d := ts.UTC()
	return time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, time.UTC)
}

func applyElo(ratingA, ratingB int, scoreA, scoreB float64) (deltaA, deltaB, newA, newB int) {
	expA := 1.0 / (1.0 + math.Pow(10, float64(ratingB-ratingA)/400.0))
	expB := 1.0 / (1.0 + math.Pow(10, float64(ratingA-ratingB)/400.0))
	newA = ratingA + int(math.Round(eloKFactor*(scoreA-expA)))
	newB = ratingB + int(math.Round(eloKFactor*(scoreB-expB)))
	deltaA = newA - ratingA
	deltaB = newB - ratingB
	return deltaA, deltaB, newA, newB
}

func duelReason(reason string) string {
	switch strings.TrimSpace(reason) {
	case "disconnect":
		return "duel_disconnect"
	case "draw":
		return "duel_draw"
	default:
		return "duel_score"
	}
}

func safeMode(mode string) string {
	if strings.TrimSpace(mode) == "" {
		return "duel"
	}
	return mode
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
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
