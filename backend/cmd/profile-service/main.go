package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

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

type meResponse struct {
	User struct {
		ID        string    `json:"id"`
		Nickname  string    `json:"nickname"`
		Type      string    `json:"type"`
		Role      string    `json:"role"`
		CreatedAt time.Time `json:"created_at"`
	} `json:"user"`
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
		authServiceURL:    envOr("AUTH_SERVICE_URL", "http://localhost:8081"),
		storageBucket:     envOr("STORAGE_BUCKET", ""),
		storagePublicBase: strings.TrimRight(envOr("STORAGE_PUBLIC_BASE_URL", ""), "/"),
		storageKeyPrefix:  strings.Trim(strings.TrimSpace(envOr("STORAGE_AVATAR_PREFIX", "avatars")), "/"),
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

	addr := ":" + envOr("PORT", "8089")
	log.Printf("profile-service on %s", addr)
	log.Fatal(http.ListenAndServe(addr, withJSON(mux)))
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
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "status": "degraded", "error": "mysql_unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": "ok", "checks": map[string]string{"mysql": "ok"}})
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
	return authUser{ID: me.User.ID, Nickname: me.User.Nickname, Type: me.User.Type, Role: me.User.Role, CreatedAt: me.User.CreatedAt}, nil
}

func (s *Server) handleMyProfile(w http.ResponseWriter, _ *http.Request, user authUser) {
	profile, err := s.loadProfile(user.ID, user)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": profile})
}

func (s *Server) handlePublicProfile(w http.ResponseWriter, r *http.Request, _ authUser) {
	userID := strings.TrimSpace(r.PathValue("userID"))
	if userID == "" {
		writeErr(w, http.StatusBadRequest, "missing_user_id")
		return
	}
	target, err := s.loadBasicUser(userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "user_not_found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	profile, err := s.loadProfile(userID, target)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": profile})
}

func (s *Server) handleUpdateMyProfile(w http.ResponseWriter, r *http.Request, user authUser) {
	var req profileUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.AvatarURL = strings.TrimSpace(req.AvatarURL)
	req.CountryCode = strings.ToUpper(strings.TrimSpace(req.CountryCode))
	req.Bio = strings.TrimSpace(req.Bio)
	if len(req.Bio) > maxBioLength {
		writeErr(w, http.StatusBadRequest, "bio_too_long")
		return
	}
	if req.CountryCode != "" && !countryCodeRE.MatchString(req.CountryCode) {
		writeErr(w, http.StatusBadRequest, "invalid_country_code")
		return
	}
	if _, err := s.db.Exec(
		`INSERT INTO user_profiles (user_id, avatar_url, country_code, bio, updated_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE avatar_url = VALUES(avatar_url), country_code = VALUES(country_code), bio = VALUES(bio), updated_at = VALUES(updated_at)`,
		user.ID, nullableString(req.AvatarURL), nullableString(req.CountryCode), nullableString(req.Bio), time.Now().UTC(),
	); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	profile, err := s.loadProfile(user.ID, user)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": profile})
}

func (s *Server) handleAvatarUploadURL(w http.ResponseWriter, r *http.Request, user authUser) {
	if s.presignClient == nil || s.storageBucket == "" || s.storagePublicBase == "" {
		writeErr(w, http.StatusServiceUnavailable, "storage_not_configured")
		return
	}
	var req avatarUploadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.FileName = strings.TrimSpace(req.FileName)
	req.ContentType = strings.TrimSpace(strings.ToLower(req.ContentType))
	if req.FileName == "" || req.ContentType == "" {
		writeErr(w, http.StatusBadRequest, "missing_file_metadata")
		return
	}
	if req.FileSize <= 0 || req.FileSize > maxAvatarFileSize {
		writeErr(w, http.StatusBadRequest, "invalid_file_size")
		return
	}
	ext, ok := avatarExtension(req.ContentType)
	if !ok {
		writeErr(w, http.StatusBadRequest, "unsupported_content_type")
		return
	}
	objectKey := s.storageKeyPrefix + "/" + user.ID + "/" + strconv.FormatInt(time.Now().UTC().UnixNano(), 10) + ext
	presigned, err := s.presignClient.PresignPutObject(r.Context(), &s3.PutObjectInput{
		Bucket:      aws.String(s.storageBucket),
		Key:         aws.String(objectKey),
		ContentType: aws.String(req.ContentType),
	}, func(opts *s3.PresignOptions) {
		opts.Expires = 10 * time.Minute
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "presign_failed")
		return
	}
	writeJSON(w, http.StatusOK, avatarUploadResponse{
		UploadURL:    presigned.URL,
		FileURL:      s.storagePublicBase + "/" + objectKey,
		ObjectKey:    objectKey,
		Method:       http.MethodPut,
		Headers:      map[string]string{"Content-Type": req.ContentType},
		ExpiresInSec: 600,
	})
}

func (s *Server) handleProfileComments(w http.ResponseWriter, r *http.Request, _ authUser) {
	targetUserID := strings.TrimSpace(r.PathValue("userID"))
	if targetUserID == "" {
		writeErr(w, http.StatusBadRequest, "missing_user_id")
		return
	}
	limit, err := parseLimit(r, defaultProfileLimit)
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
		`SELECT pc.id, pc.author_user_id, COALESCE(u.nickname, ''), pc.target_user_id, pc.parent_comment_id, pc.text, pc.deleted_at, pc.created_at
		 FROM profile_comments pc
		 LEFT JOIN users u ON u.id = CAST(SUBSTRING(pc.author_user_id, 3) AS UNSIGNED)
		 WHERE pc.target_user_id = ?
		 ORDER BY pc.created_at DESC, pc.id DESC
		 LIMIT ? OFFSET ?`,
		targetUserID, limit+1, offset,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer rows.Close()
	comments := make([]profileComment, 0, limit+1)
	for rows.Next() {
		var rawID int64
		var parentID sql.NullInt64
		var deletedAt sql.NullTime
		var c profileComment
		if err := rows.Scan(&rawID, &c.AuthorUserID, &c.AuthorNickname, &c.TargetUserID, &parentID, &c.Text, &deletedAt, &c.CreatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		c.ID = encodeCommentID(rawID)
		if parentID.Valid {
			c.ParentCommentID = encodeCommentID(parentID.Int64)
		}
		if deletedAt.Valid {
			c.IsDeleted = true
			c.Text = ""
		}
		comments = append(comments, c)
	}
	nextCursor := ""
	if len(comments) > limit {
		nextCursor = encodeCursor(offset + limit)
		comments = comments[:limit]
	}
	writeJSON(w, http.StatusOK, map[string]any{"comments": comments, "next_cursor": nextCursor})
}

func (s *Server) handlePostProfileComment(w http.ResponseWriter, r *http.Request, user authUser) {
	targetUserID := strings.TrimSpace(r.PathValue("userID"))
	if targetUserID == "" {
		writeErr(w, http.StatusBadRequest, "missing_user_id")
		return
	}
	if _, err := s.loadBasicUser(targetUserID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "user_not_found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	var req profileCommentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.Text = strings.TrimSpace(req.Text)
	req.ParentCommentID = strings.TrimSpace(req.ParentCommentID)
	if req.Text == "" {
		writeErr(w, http.StatusBadRequest, "empty_comment")
		return
	}
	if len(req.Text) > maxCommentLength {
		writeErr(w, http.StatusBadRequest, "comment_too_long")
		return
	}
	var parentCommentID any
	if req.ParentCommentID != "" {
		rawParentID, err := decodeCommentID(req.ParentCommentID)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid_parent_comment_id")
			return
		}
		var parentTargetUserID string
		var parentDeletedAt sql.NullTime
		if err := s.db.QueryRow(
			`SELECT target_user_id, deleted_at FROM profile_comments WHERE id = ?`,
			rawParentID,
		).Scan(&parentTargetUserID, &parentDeletedAt); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeErr(w, http.StatusNotFound, "parent_comment_not_found")
				return
			}
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		if parentTargetUserID != targetUserID {
			writeErr(w, http.StatusBadRequest, "parent_comment_target_mismatch")
			return
		}
		if parentDeletedAt.Valid {
			writeErr(w, http.StatusBadRequest, "parent_comment_deleted")
			return
		}
		parentCommentID = rawParentID
	}
	now := time.Now().UTC()
	res, err := s.db.Exec(
		`INSERT INTO profile_comments (author_user_id, target_user_id, parent_comment_id, text, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		user.ID, targetUserID, parentCommentID, req.Text, now,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	rawID, _ := res.LastInsertId()
	comment := profileComment{
		ID:              encodeCommentID(rawID),
		AuthorUserID:    user.ID,
		AuthorNickname:  user.Nickname,
		TargetUserID:    targetUserID,
		ParentCommentID: req.ParentCommentID,
		Text:            req.Text,
		CreatedAt:       now,
	}
	writeJSON(w, http.StatusOK, map[string]any{"comment": comment})
}

func (s *Server) handleDeleteProfileComment(w http.ResponseWriter, r *http.Request, user authUser) {
	targetUserID := strings.TrimSpace(r.PathValue("userID"))
	commentID := strings.TrimSpace(r.PathValue("commentID"))
	if targetUserID == "" || commentID == "" {
		writeErr(w, http.StatusBadRequest, "missing_comment_context")
		return
	}
	rawCommentID, err := decodeCommentID(commentID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_comment_id")
		return
	}
	var authorUserID, storedTargetUserID string
	var deletedAt sql.NullTime
	if err := s.db.QueryRow(
		`SELECT author_user_id, target_user_id, deleted_at FROM profile_comments WHERE id = ?`,
		rawCommentID,
	).Scan(&authorUserID, &storedTargetUserID, &deletedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "comment_not_found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	if storedTargetUserID != targetUserID {
		writeErr(w, http.StatusBadRequest, "comment_target_mismatch")
		return
	}
	if user.ID != authorUserID && user.ID != targetUserID && user.Role != "admin" {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	if !deletedAt.Valid {
		if _, err := s.db.Exec(
			`UPDATE profile_comments
			 SET text = '', deleted_at = ?, deleted_by_user_id = ?
			 WHERE id = ?`,
			time.Now().UTC(), user.ID, rawCommentID,
		); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "comment_id": commentID, "is_deleted": true})
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

func (s *Server) loadProfile(userID string, user authUser) (*profileResponse, error) {
	profile := &profileResponse{
		UserID:         userID,
		Nickname:       user.Nickname,
		Type:           user.Type,
		Role:           user.Role,
		MemberSince:    user.CreatedAt,
		AccountAgeDays: int(time.Since(user.CreatedAt).Hours() / 24),
		SelectedBadges: []map[string]any{},
		RecentForm:     []string{},
	}

	var avatarURL, countryCode, bio sql.NullString
	_ = s.db.QueryRow(`SELECT avatar_url, country_code, bio FROM user_profiles WHERE user_id = ?`, userID).Scan(&avatarURL, &countryCode, &bio)
	profile.AvatarURL = avatarURL.String
	profile.CountryCode = countryCode.String
	profile.Bio = bio.String

	var rating, peak sql.NullInt64
	_ = s.db.QueryRow(`SELECT rating, peak_rating FROM user_ratings WHERE user_id = ?`, userID).Scan(&rating, &peak)
	if rating.Valid {
		profile.Rating = int(rating.Int64)
		profile.PeakRating = int(peak.Int64)
	} else {
		profile.Rating = 1500
		profile.PeakRating = 1500
	}
	applyRank(profile)

	rows, err := s.db.Query(
		`SELECT result, rating_delta, my_score, started_at, finished_at
		 FROM user_match_history
		 WHERE user_id = ?
		 ORDER BY finished_at DESC, id DESC`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var scoreSum float64
	var bestScore float64
	var recentScore float64
	var lastMatchAt *time.Time
	var bestWinDelta, worstLossDelta int
	var gainCount, lossCount int
	first := true
	for rows.Next() {
		var result string
		var delta int
		var score float64
		var startedAt, finishedAt time.Time
		if err := rows.Scan(&result, &delta, &score, &startedAt, &finishedAt); err != nil {
			return nil, err
		}
		profile.Matches++
		scoreSum += score
		if score > bestScore {
			bestScore = score
		}
		if first {
			recentScore = score
			lastMatchAt = &finishedAt
			first = false
		}
		switch result {
		case "win":
			profile.Wins++
			if delta > bestWinDelta {
				bestWinDelta = delta
			}
			if profile.Streak >= 0 {
				profile.Streak++
			}
		case "loss":
			profile.Losses++
			if worstLossDelta == 0 || delta < worstLossDelta {
				worstLossDelta = delta
			}
			if profile.Streak <= 0 {
				profile.Streak--
			}
		}
		if len(profile.RecentForm) < 5 {
			profile.RecentForm = append(profile.RecentForm, resultLetter(result))
		}
		if delta > 0 {
			gainCount++
		}
		if delta < 0 {
			lossCount++
		}
	}
	if profile.Matches > 0 {
		profile.WinRate = round2(float64(profile.Wins) * 100 / float64(profile.Matches))
		profile.AverageScore = round2(scoreSum / float64(profile.Matches))
	}
	profile.BestScore = round2(bestScore)
	profile.RecentScore = round2(recentScore)
	profile.LastMatchAt = lastMatchAt
	profile.BestWinRatingDelta = bestWinDelta
	profile.WorstLossRatingDelta = worstLossDelta
	profile.FavoriteMode = "duel"

	_ = s.db.QueryRow(`SELECT COALESCE(AVG(op.rating),0)
		FROM user_match_history umh
		JOIN user_ratings op ON op.user_id = umh.opponent_user_id
		WHERE umh.user_id = ?`, userID).Scan(&profile.AvgOpponentRating)
	profile.AvgOpponentRating = round2(profile.AvgOpponentRating)

	_ = s.db.QueryRow(`SELECT COALESCE(MAX(final_average),0), COALESCE(AVG(final_average),0)
		FROM test_lab_sessions s
		JOIN test_lab_rooms r ON r.id = s.room_id
		WHERE r.owner_id = ? AND s.final_average IS NOT NULL`, userID).Scan(&profile.TestLabBest, &profile.TestLabAverage)
	profile.TestLabBest = round2(profile.TestLabBest)
	profile.TestLabAverage = round2(profile.TestLabAverage)

	if err := s.loadSelectedCosmetics(profile); err != nil {
		return nil, err
	}
	return profile, nil
}

func (s *Server) loadSelectedCosmetics(profile *profileResponse) error {
	var titleID, nicknameColorID, titleFrameID sql.NullString
	var badgeRaw []byte
	err := s.db.QueryRow(
		`SELECT title_id, nickname_color_id, title_frame_id, badge_ids_json
		 FROM user_chat_customization_selection WHERE user_id = ?`, profile.UserID,
	).Scan(&titleID, &nicknameColorID, &titleFrameID, &badgeRaw)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if titleID.Valid {
		item, err := s.loadChatItemPreview(titleID.String)
		if err == nil {
			profile.SelectedTitle = item
		}
	}
	if nicknameColorID.Valid {
		item, err := s.loadChatItemPreview(nicknameColorID.String)
		if err == nil {
			profile.NicknameStyle = item
		}
	}
	if titleFrameID.Valid {
		item, err := s.loadChatItemPreview(titleFrameID.String)
		if err == nil {
			profile.AvatarFrame = item
		}
	}
	var badgeIDs []string
	_ = json.Unmarshal(badgeRaw, &badgeIDs)
	for _, badgeID := range badgeIDs {
		item, err := s.loadChatItemPreview(badgeID)
		if err == nil {
			profile.SelectedBadges = append(profile.SelectedBadges, item)
		}
	}
	return nil
}

func (s *Server) loadChatItemPreview(itemID string) (map[string]any, error) {
	var previewRaw []byte
	if err := s.db.QueryRow(`SELECT preview_json FROM chat_customization_items WHERE id = ?`, itemID).Scan(&previewRaw); err != nil {
		return nil, err
	}
	out := map[string]any{}
	if err := json.Unmarshal(previewRaw, &out); err != nil {
		return nil, err
	}
	return out, nil
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

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func buildPresignClient() (*s3.PresignClient, error) {
	accessKey := envOr("STORAGE_ACCESS_KEY", "")
	secretKey := envOr("STORAGE_SECRET_KEY", "")
	endpoint := strings.TrimRight(envOr("STORAGE_ENDPOINT", ""), "/")
	region := envOr("STORAGE_REGION", "us-east-1")
	if accessKey == "" || secretKey == "" || endpoint == "" {
		return nil, errors.New("missing_storage_env")
	}
	cfg, err := config.LoadDefaultConfig(
		context.Background(),
		config.WithRegion(region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKey, secretKey, "")),
	)
	if err != nil {
		return nil, err
	}
	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(endpoint)
		o.UsePathStyle = false
	})
	return s3.NewPresignClient(client), nil
}

func avatarExtension(contentType string) (string, bool) {
	switch contentType {
	case "image/jpeg", "image/jpg":
		return ".jpg", true
	case "image/png":
		return ".png", true
	case "image/webp":
		return ".webp", true
	default:
		return "", false
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
