package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"backend/internal/httputil"
	"backend/internal/mysqlutil"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

const (
	defaultProfileLimit = 20
	maxProfileLimit     = 100
	maxBioLength        = 280
	maxCommentLength    = 1000
	maxAvatarFileSize   = 5 * 1024 * 1024
)

var countryCodeRE = regexp.MustCompile(`^[A-Z]{2}$`)

type Server struct {
	db                *sql.DB
	authServiceURL    string
	storageBucket     string
	storagePublicBase string
	storageKeyPrefix  string
	presignClient     *s3.PresignClient
}

type authUser struct {
	ID        string
	Nickname  string
	Type      string
	Role      string
	CreatedAt time.Time
}

type profileUpdateRequest struct {
	AvatarURL   string `json:"avatar_url"`
	CountryCode string `json:"country_code"`
	Bio         string `json:"bio"`
}

type profileCommentRequest struct {
	Text            string `json:"text"`
	ParentCommentID string `json:"parent_comment_id"`
}

type profileCommentVoteRequest struct {
	Value int `json:"value"`
}

type avatarUploadRequest struct {
	FileName    string `json:"file_name"`
	ContentType string `json:"content_type"`
	FileSize    int64  `json:"file_size"`
}

type avatarUploadResponse struct {
	UploadURL    string            `json:"upload_url"`
	FileURL      string            `json:"file_url"`
	ObjectKey    string            `json:"object_key"`
	Method       string            `json:"method"`
	Headers      map[string]string `json:"headers"`
	ExpiresInSec int64             `json:"expires_in_sec"`
}

type profileComment struct {
	ID              string    `json:"id"`
	AuthorUserID    string    `json:"author_user_id"`
	AuthorNickname  string    `json:"author_nickname"`
	TargetUserID    string    `json:"target_user_id"`
	ParentCommentID string    `json:"parent_comment_id,omitempty"`
	Text            string    `json:"text"`
	IsDeleted       bool      `json:"is_deleted,omitempty"`
	LikeCount       int       `json:"like_count"`
	DislikeCount    int       `json:"dislike_count"`
	MyVote          int       `json:"my_vote"`
	CreatedAt       time.Time `json:"created_at"`
}

type profileResponse struct {
	UserID               string           `json:"user_id"`
	Nickname             string           `json:"nickname,omitempty"`
	Type                 string           `json:"type"`
	Role                 string           `json:"role,omitempty"`
	AvatarURL            string           `json:"avatar_url,omitempty"`
	CountryCode          string           `json:"country_code,omitempty"`
	Bio                  string           `json:"bio,omitempty"`
	MemberSince          time.Time        `json:"member_since"`
	AccountAgeDays       int              `json:"account_age_days"`
	Rating               int              `json:"rating"`
	PeakRating           int              `json:"peak_rating"`
	Rank                 string           `json:"rank"`
	NextRank             string           `json:"next_rank,omitempty"`
	ProgressPercent      int              `json:"progress_percent"`
	Wins                 int              `json:"wins"`
	Losses               int              `json:"losses"`
	Matches              int              `json:"matches"`
	WinRate              float64          `json:"win_rate"`
	Streak               int              `json:"streak"`
	AverageScore         float64          `json:"average_score"`
	BestScore            float64          `json:"best_score"`
	RecentScore          float64          `json:"recent_score"`
	TestLabBest          float64          `json:"test_lab_best"`
	TestLabAverage       float64          `json:"test_lab_average"`
	RecentForm           []string         `json:"recent_form"`
	LastMatchAt          *time.Time       `json:"last_match_at,omitempty"`
	FavoriteMode         string           `json:"favorite_mode,omitempty"`
	AvgOpponentRating    float64          `json:"avg_opponent_rating"`
	BestWinRatingDelta   int              `json:"best_win_rating_delta"`
	WorstLossRatingDelta int              `json:"worst_loss_rating_delta"`
	SelectedTitle        map[string]any   `json:"selected_title,omitempty"`
	SelectedBadges       []map[string]any `json:"selected_badges"`
	NicknameStyle        map[string]any   `json:"nickname_style,omitempty"`
	AvatarFrame          map[string]any   `json:"avatar_frame,omitempty"`
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

func main() {
	db, err := mysqlutil.OpenFromEnv()
	if err != nil {
		log.Fatalf("open mysql: %v", err)
	}
	if err := mysqlutil.ExecStatements(db, profileSchema()); err != nil {
		log.Fatalf("profile schema: %v", err)
	}
	if err := ensureProfileSchema(db); err != nil {
		log.Fatalf("profile schema: %v", err)
	}

	s := &Server{
		db:                db,
		authServiceURL:    httputil.EnvOr("AUTH_SERVICE_URL", "http://localhost:8081"),
		storageBucket:     httputil.EnvOr("STORAGE_BUCKET", ""),
		storagePublicBase: strings.TrimRight(httputil.EnvOr("STORAGE_PUBLIC_BASE_URL", ""), "/"),
		storageKeyPrefix:  strings.Trim(strings.TrimSpace(httputil.EnvOr("STORAGE_AVATAR_PREFIX", "avatars")), "/"),
	}
	if s.storageBucket != "" {
		presignClient, err := buildPresignClient()
		if err != nil {
			log.Fatalf("build storage presign client: %v", err)
		}
		s.presignClient = presignClient
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /profiles/me", s.withAuth(s.handleMyProfile))
	mux.HandleFunc("PATCH /profiles/me", s.withAuth(s.handleUpdateMyProfile))
	mux.HandleFunc("POST /profiles/me/avatar-upload", s.withAuth(s.handleAvatarUploadURL))
	mux.HandleFunc("GET /profiles/{userID}", s.withAuth(s.handlePublicProfile))
	mux.HandleFunc("GET /profiles/{userID}/comments", s.withAuth(s.handleProfileComments))
	mux.HandleFunc("POST /profiles/{userID}/comments", s.withAuth(s.handlePostProfileComment))
	mux.HandleFunc("DELETE /profiles/{userID}/comments/{commentID}", s.withAuth(s.handleDeleteProfileComment))
	mux.HandleFunc("POST /profiles/{userID}/comments/{commentID}/vote", s.withAuth(s.handleVoteProfileComment))

	addr := ":" + httputil.EnvOr("PORT", "8089")
	log.Printf("profile-service on %s", addr)
	log.Fatal(http.ListenAndServe(addr, httputil.WithJSON(mux)))
}

func profileSchema() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS user_profiles (
			user_id VARCHAR(64) NOT NULL PRIMARY KEY,
			avatar_url VARCHAR(512) NULL,
			country_code CHAR(2) NULL,
			bio VARCHAR(280) NULL,
			updated_at DATETIME(6) NOT NULL
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS profile_comments (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
			author_user_id VARCHAR(64) NOT NULL,
			target_user_id VARCHAR(64) NOT NULL,
			parent_comment_id BIGINT UNSIGNED NULL,
			text TEXT NOT NULL,
			deleted_at DATETIME(6) NULL,
			deleted_by_user_id VARCHAR(64) NULL,
			created_at DATETIME(6) NOT NULL,
			INDEX idx_profile_comments_target_created (target_user_id, created_at DESC),
			INDEX idx_profile_comments_parent (parent_comment_id)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS profile_comment_votes (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
			comment_id BIGINT UNSIGNED NOT NULL,
			user_id VARCHAR(64) NOT NULL,
			value TINYINT NOT NULL,
			created_at DATETIME(6) NOT NULL,
			updated_at DATETIME(6) NOT NULL,
			UNIQUE KEY uniq_profile_comment_vote (comment_id, user_id),
			INDEX idx_profile_comment_votes_comment (comment_id)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
	}
}

func ensureProfileSchema(db *sql.DB) error {
	hasParentColumn, err := mysqlutil.ColumnExists(db, "profile_comments", "parent_comment_id")
	if err != nil {
		return err
	}
	if !hasParentColumn {
		if _, err := db.Exec(`ALTER TABLE profile_comments ADD COLUMN parent_comment_id BIGINT UNSIGNED NULL AFTER target_user_id`); err != nil {
			return err
		}
	}
	hasParentIndex, err := mysqlutil.IndexExists(db, "profile_comments", "idx_profile_comments_parent")
	if err != nil {
		return err
	}
	if !hasParentIndex {
		if _, err := db.Exec(`ALTER TABLE profile_comments ADD INDEX idx_profile_comments_parent (parent_comment_id)`); err != nil {
			return err
		}
	}
	hasDeletedAt, err := mysqlutil.ColumnExists(db, "profile_comments", "deleted_at")
	if err != nil {
		return err
	}
	if !hasDeletedAt {
		if _, err := db.Exec(`ALTER TABLE profile_comments ADD COLUMN deleted_at DATETIME(6) NULL AFTER text`); err != nil {
			return err
		}
	}
	hasDeletedBy, err := mysqlutil.ColumnExists(db, "profile_comments", "deleted_by_user_id")
	if err != nil {
		return err
	}
	if !hasDeletedBy {
		if _, err := db.Exec(`ALTER TABLE profile_comments ADD COLUMN deleted_by_user_id VARCHAR(64) NULL AFTER deleted_at`); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	if err := mysqlutil.Ping(s.db); err != nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "status": "degraded", "error": "mysql_unavailable"})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "status": "ok", "checks": map[string]string{"mysql": "ok"}})
}

func (s *Server) withAuth(next func(http.ResponseWriter, *http.Request, authUser)) http.HandlerFunc {
	return httputil.WithAuth(s.authServiceURL, func(w http.ResponseWriter, r *http.Request, u httputil.User) {
		next(w, r, authUser{ID: u.ID, Nickname: u.Nickname, Type: u.Type, Role: u.Role, CreatedAt: u.CreatedAt})
	})
}

func buildPresignClient() (*s3.PresignClient, error) {
	cfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithRegion(httputil.EnvOr("STORAGE_REGION", "us-east-1")),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			httputil.EnvOr("STORAGE_ACCESS_KEY", ""),
			httputil.EnvOr("STORAGE_SECRET_KEY", ""),
			"",
		)),
	)
	if err != nil {
		return nil, err
	}
	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(httputil.EnvOr("STORAGE_ENDPOINT", ""))
	})
	return s3.NewPresignClient(client), nil
}

func (s *Server) loadBasicUser(userID string) (authUser, error) {
	rawID, err := rawUserID(userID)
	if err != nil {
		return authUser{}, err
	}
	var user authUser
	err = s.db.QueryRow(`SELECT nickname, type, role, created_at FROM users WHERE id = ?`, rawID).Scan(&user.Nickname, &user.Type, &user.Role, &user.CreatedAt)
	if err != nil {
		return authUser{}, err
	}
	user.ID = userID
	return user, nil
}

func applyRank(profile *profileResponse) {
	for i, band := range rankBands {
		if profile.Rating < band.Min || profile.Rating > band.Max {
			continue
		}
		profile.Rank = band.Name
		if i == len(rankBands)-1 {
			profile.ProgressPercent = 100
			return
		}
		next := rankBands[i+1]
		profile.NextRank = next.Name
		width := next.Min - band.Min
		if width > 0 {
			progress := (profile.Rating - band.Min) * 100 / width
			if progress < 0 {
				progress = 0
			}
			if progress > 100 {
				progress = 100
			}
			profile.ProgressPercent = progress
		}
		return
	}
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

func parseLimit(r *http.Request, fallback int) (int, error) {
	limit := fallback
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > maxProfileLimit {
			return 0, errors.New("invalid_limit")
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
	offset, err := strconv.Atoi(string(data))
	if err != nil || offset < 0 {
		return 0, errors.New("invalid_cursor")
	}
	return offset, nil
}

func rawUserID(userID string) (int64, error) {
	if !strings.HasPrefix(userID, "u_") {
		return 0, errors.New("invalid_user_id")
	}
	return strconv.ParseInt(strings.TrimPrefix(userID, "u_"), 10, 64)
}

func encodeCommentID(id int64) string {
	return "pc_" + strconv.FormatInt(id, 10)
}

func decodeCommentID(commentID string) (int64, error) {
	if !strings.HasPrefix(commentID, "pc_") {
		return 0, errors.New("invalid_comment_id")
	}
	return strconv.ParseInt(strings.TrimPrefix(commentID, "pc_"), 10, 64)
}

func nullableString(v string) any {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return v
}

func round2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}
