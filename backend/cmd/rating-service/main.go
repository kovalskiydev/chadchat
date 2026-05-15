package main

import (
	"database/sql"
	"encoding/base64"
	"errors"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"backend/internal/httputil"
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
		authServiceURL: httputil.EnvOr("AUTH_SERVICE_URL", "http://localhost:8081"),
		internalSecret: httputil.EnvOr("RATING_INTERNAL_SECRET", "dev-rating-secret-change-me"),
		queueType:      httputil.EnvOr("DEFAULT_QUEUE_TYPE", defaultQueueType),
		region:         httputil.EnvOr("DEFAULT_REGION", defaultRegion),
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

	addr := ":" + httputil.EnvOr("PORT", "8086")
	log.Printf("rating-service on %s", addr)
	log.Fatal(http.ListenAndServe(addr, httputil.WithJSON(mux)))
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
		httputil.WriteJSON(w, http.StatusServiceUnavailable, map[string]any{
			"ok":     false,
			"status": "degraded",
			"error":  "mysql_unavailable",
		})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"status": "ok",
		"checks": map[string]string{"mysql": "ok"},
	})
}

func (s *Server) withAuth(next func(http.ResponseWriter, *http.Request, authUser)) http.HandlerFunc {
	return httputil.WithAuth(s.authServiceURL, func(w http.ResponseWriter, r *http.Request, u httputil.User) {
		next(w, r, authUser{ID: u.ID, Nickname: u.Nickname})
	})
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

func applyElo(ratingA, ratingB int, scoreA, scoreB float64) (deltaA, deltaB, newA, newB int) {
	expA := 1.0 / (1.0 + math.Pow(10, float64(ratingB-ratingA)/400.0))
	expB := 1.0 / (1.0 + math.Pow(10, float64(ratingA-ratingB)/400.0))
	newA = ratingA + int(math.Round(eloKFactor*(scoreA-expA)))
	newB = ratingB + int(math.Round(eloKFactor*(scoreB-expB)))
	deltaA = newA - ratingA
	deltaB = newB - ratingB
	return deltaA, deltaB, newA, newB
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
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
