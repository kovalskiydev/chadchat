package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
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
