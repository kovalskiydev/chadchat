package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"backend/internal/mysqlutil"
	"backend/internal/rateutil"
)

const defaultUserRating = 1500

type Server struct {
	db             *sql.DB
	authServiceURL string
	internalSecret string
	limiter        *rateutil.Limiter
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
	UserID     string `json:"user_id"`
	Nickname   string `json:"nickname,omitempty"`
	Rating     int    `json:"rating"`
	PeakRating int    `json:"peak_rating"`
	Rank       string `json:"rank"`
}

type adjustRatingRequest struct {
	UserID   string `json:"user_id"`
	Delta    int    `json:"delta"`
	Reason   string `json:"reason"`
	SourceID string `json:"source_id,omitempty"`
}

type rankBand struct {
	Name string
	Min  int
	Max  int
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
		limiter:        rateutil.NewLimiter(),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /rating/me", s.withAuth(s.handleMyRating))
	mux.HandleFunc("GET /rating/{userID}", s.withAuth(s.handleUserRating))
	mux.HandleFunc("GET /leaderboard", s.withAuth(s.handleLeaderboard))
	mux.HandleFunc("POST /rating/internal/adjust", s.handleInternalAdjust)

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
			INDEX idx_user_ratings_rating (rating DESC)
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
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeErr(w, http.StatusBadRequest, "invalid_limit")
			return
		}
		limit = parsed
	}

	rows, err := s.db.Query(
		`SELECT ur.user_id, COALESCE(u.nickname, ''), ur.rating, ur.peak_rating
		 FROM user_ratings ur
		 LEFT JOIN users u ON u.id = CAST(SUBSTRING(ur.user_id, 3) AS UNSIGNED)
		 ORDER BY ur.rating DESC, ur.updated_at ASC
		 LIMIT ?`,
		limit,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer rows.Close()

	entries := make([]leaderboardEntry, 0, limit)
	for rows.Next() {
		var entry leaderboardEntry
		if err := rows.Scan(&entry.UserID, &entry.Nickname, &entry.Rating, &entry.PeakRating); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		entry.Rank = rankFromRating(entry.Rating).Name
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

func (s *Server) handleInternalAdjust(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Rating-Internal-Secret") != s.internalSecret {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}

	var req adjustRatingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if req.UserID == "" {
		writeErr(w, http.StatusBadRequest, "missing_user_id")
		return
	}
	if req.Reason == "" {
		req.Reason = "manual"
	}

	profile, err := s.ensureAndLoadRating(req.UserID, "")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	oldRating := profile.Rating
	newRating := oldRating + req.Delta
	if newRating < 0 {
		newRating = 0
	}
	peakRating := profile.PeakRating
	if newRating > peakRating {
		peakRating = newRating
	}

	now := time.Now().UTC()
	if _, err := s.db.Exec(
		`UPDATE user_ratings SET rating = ?, peak_rating = ?, updated_at = ? WHERE user_id = ?`,
		newRating, peakRating, now, req.UserID,
	); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	if _, err := s.db.Exec(
		`INSERT INTO rating_history (user_id, delta, old_rating, new_rating, reason, source_id, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		req.UserID, req.Delta, oldRating, newRating, req.Reason, nullableString(req.SourceID), now,
	); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	updated, err := s.ensureAndLoadRating(req.UserID, profile.Nickname)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rating": updated})
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

	profile := &RatingProfile{}
	err = s.db.QueryRow(
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

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
