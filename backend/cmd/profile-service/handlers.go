package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"backend/internal/httputil"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

func (s *Server) handleMyProfile(w http.ResponseWriter, _ *http.Request, user authUser) {
	profile, err := s.loadProfile(user.ID, user)
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"profile": profile})
}

func (s *Server) handlePublicProfile(w http.ResponseWriter, r *http.Request, _ authUser) {
	userID := strings.TrimSpace(r.PathValue("userID"))
	if userID == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_user_id")
		return
	}
	target, err := s.loadBasicUser(userID)
	if err != nil {
		if err == sql.ErrNoRows {
			httputil.WriteErr(w, http.StatusNotFound, "user_not_found")
			return
		}
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	profile, err := s.loadProfile(userID, target)
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"profile": profile})
}

func (s *Server) handleUpdateMyProfile(w http.ResponseWriter, r *http.Request, user authUser) {
	var req profileUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.AvatarURL = strings.TrimSpace(req.AvatarURL)
	req.CountryCode = strings.ToUpper(strings.TrimSpace(req.CountryCode))
	req.Bio = strings.TrimSpace(req.Bio)
	if len(req.Bio) > maxBioLength {
		httputil.WriteErr(w, http.StatusBadRequest, "bio_too_long")
		return
	}
	if req.CountryCode != "" && !countryCodeRE.MatchString(req.CountryCode) {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_country_code")
		return
	}
	if _, err := s.db.Exec(
		`INSERT INTO user_profiles (user_id, avatar_url, country_code, bio, updated_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE avatar_url = VALUES(avatar_url), country_code = VALUES(country_code), bio = VALUES(bio), updated_at = VALUES(updated_at)`,
		user.ID, nullableString(req.AvatarURL), nullableString(req.CountryCode), nullableString(req.Bio), time.Now().UTC(),
	); err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	profile, err := s.loadProfile(user.ID, user)
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"profile": profile})
}

func (s *Server) handleAvatarUploadURL(w http.ResponseWriter, r *http.Request, user authUser) {
	if s.presignClient == nil || s.storageBucket == "" || s.storagePublicBase == "" {
		httputil.WriteErr(w, http.StatusServiceUnavailable, "storage_not_configured")
		return
	}
	var req avatarUploadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.FileName = strings.TrimSpace(req.FileName)
	req.ContentType = strings.TrimSpace(strings.ToLower(req.ContentType))
	if req.FileName == "" || req.ContentType == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_file_metadata")
		return
	}
	if req.FileSize <= 0 || req.FileSize > maxAvatarFileSize {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_file_size")
		return
	}
	ext, ok := avatarExtension(req.ContentType)
	if !ok {
		httputil.WriteErr(w, http.StatusBadRequest, "unsupported_content_type")
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
		httputil.WriteErr(w, http.StatusInternalServerError, "presign_failed")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, avatarUploadResponse{
		UploadURL:    presigned.URL,
		FileURL:      s.storagePublicBase + "/" + objectKey,
		ObjectKey:    objectKey,
		Method:       http.MethodPut,
		Headers:      map[string]string{"Content-Type": req.ContentType},
		ExpiresInSec: 600,
	})
}

func (s *Server) handleProfileComments(w http.ResponseWriter, r *http.Request, user authUser) {
	targetUserID := strings.TrimSpace(r.PathValue("userID"))
	if targetUserID == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_user_id")
		return
	}
	limit, err := parseLimit(r, defaultProfileLimit)
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
		`SELECT pc.id, pc.author_user_id, COALESCE(u.nickname, ''), pc.target_user_id, pc.parent_comment_id, pc.text, pc.deleted_at,
		        COALESCE(v.likes, 0), COALESCE(v.dislikes, 0), COALESCE(uv.value, 0), pc.created_at
		 FROM profile_comments pc
		 LEFT JOIN users u ON u.id = CAST(SUBSTRING(pc.author_user_id, 3) AS UNSIGNED)
		 LEFT JOIN (
		 	SELECT comment_id,
		 	       SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END) AS likes,
		 	       SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END) AS dislikes
		 	FROM profile_comment_votes
		 	GROUP BY comment_id
		 ) v ON v.comment_id = pc.id
		 LEFT JOIN profile_comment_votes uv ON uv.comment_id = pc.id AND uv.user_id = ?
		 WHERE pc.target_user_id = ?
		 ORDER BY pc.created_at DESC, pc.id DESC
		 LIMIT ? OFFSET ?`,
		user.ID, targetUserID, limit+1, offset,
	)
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer rows.Close()
	comments := make([]profileComment, 0, limit+1)
	for rows.Next() {
		var rawID int64
		var parentID sql.NullInt64
		var deletedAt sql.NullTime
		var c profileComment
		if err := rows.Scan(&rawID, &c.AuthorUserID, &c.AuthorNickname, &c.TargetUserID, &parentID, &c.Text, &deletedAt, &c.LikeCount, &c.DislikeCount, &c.MyVote, &c.CreatedAt); err != nil {
			httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
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
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"comments": comments, "next_cursor": nextCursor})
}

func (s *Server) handlePostProfileComment(w http.ResponseWriter, r *http.Request, user authUser) {
	targetUserID := strings.TrimSpace(r.PathValue("userID"))
	if targetUserID == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_user_id")
		return
	}
	if _, err := s.loadBasicUser(targetUserID); err != nil {
		if err == sql.ErrNoRows {
			httputil.WriteErr(w, http.StatusNotFound, "user_not_found")
			return
		}
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	var req profileCommentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.Text = strings.TrimSpace(req.Text)
	req.ParentCommentID = strings.TrimSpace(req.ParentCommentID)
	if req.Text == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "empty_comment")
		return
	}
	if len(req.Text) > maxCommentLength {
		httputil.WriteErr(w, http.StatusBadRequest, "comment_too_long")
		return
	}
	var parentCommentID any
	if req.ParentCommentID != "" {
		rawParentID, err := decodeCommentID(req.ParentCommentID)
		if err != nil {
			httputil.WriteErr(w, http.StatusBadRequest, "invalid_parent_comment_id")
			return
		}
		var parentTargetUserID string
		var parentDeletedAt sql.NullTime
		if err := s.db.QueryRow(
			`SELECT target_user_id, deleted_at FROM profile_comments WHERE id = ?`,
			rawParentID,
		).Scan(&parentTargetUserID, &parentDeletedAt); err != nil {
			if err == sql.ErrNoRows {
				httputil.WriteErr(w, http.StatusNotFound, "parent_comment_not_found")
				return
			}
			httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		if parentTargetUserID != targetUserID {
			httputil.WriteErr(w, http.StatusBadRequest, "parent_comment_target_mismatch")
			return
		}
		if parentDeletedAt.Valid {
			httputil.WriteErr(w, http.StatusBadRequest, "parent_comment_deleted")
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
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
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
		LikeCount:       0,
		DislikeCount:    0,
		MyVote:          0,
		CreatedAt:       now,
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"comment": comment})
}

func (s *Server) handleDeleteProfileComment(w http.ResponseWriter, r *http.Request, user authUser) {
	targetUserID := strings.TrimSpace(r.PathValue("userID"))
	commentID := strings.TrimSpace(r.PathValue("commentID"))
	if targetUserID == "" || commentID == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_comment_context")
		return
	}
	rawCommentID, err := decodeCommentID(commentID)
	if err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_comment_id")
		return
	}
	var authorUserID, storedTargetUserID string
	var deletedAt sql.NullTime
	if err := s.db.QueryRow(
		`SELECT author_user_id, target_user_id, deleted_at FROM profile_comments WHERE id = ?`,
		rawCommentID,
	).Scan(&authorUserID, &storedTargetUserID, &deletedAt); err != nil {
		if err == sql.ErrNoRows {
			httputil.WriteErr(w, http.StatusNotFound, "comment_not_found")
			return
		}
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	if storedTargetUserID != targetUserID {
		httputil.WriteErr(w, http.StatusBadRequest, "comment_target_mismatch")
		return
	}
	if user.ID != authorUserID && user.ID != targetUserID && user.Role != "admin" {
		httputil.WriteErr(w, http.StatusForbidden, "forbidden")
		return
	}
	if !deletedAt.Valid {
		if _, err := s.db.Exec(
			`UPDATE profile_comments
			 SET text = '', deleted_at = ?, deleted_by_user_id = ?
			 WHERE id = ?`,
			time.Now().UTC(), user.ID, rawCommentID,
		); err != nil {
			httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
			return
		}
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"status": "ok", "comment_id": commentID, "is_deleted": true})
}

func (s *Server) handleVoteProfileComment(w http.ResponseWriter, r *http.Request, user authUser) {
	targetUserID := strings.TrimSpace(r.PathValue("userID"))
	commentID := strings.TrimSpace(r.PathValue("commentID"))
	if targetUserID == "" || commentID == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_comment_context")
		return
	}
	rawCommentID, err := decodeCommentID(commentID)
	if err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_comment_id")
		return
	}
	var req profileCommentVoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if req.Value != -1 && req.Value != 0 && req.Value != 1 {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_vote_value")
		return
	}
	var storedTargetUserID string
	var deletedAt sql.NullTime
	if err := s.db.QueryRow(
		`SELECT target_user_id, deleted_at FROM profile_comments WHERE id = ?`,
		rawCommentID,
	).Scan(&storedTargetUserID, &deletedAt); err != nil {
		if err == sql.ErrNoRows {
			httputil.WriteErr(w, http.StatusNotFound, "comment_not_found")
			return
		}
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	if storedTargetUserID != targetUserID {
		httputil.WriteErr(w, http.StatusBadRequest, "comment_target_mismatch")
		return
	}
	if deletedAt.Valid {
		httputil.WriteErr(w, http.StatusBadRequest, "comment_deleted")
		return
	}
	now := time.Now().UTC()
	if req.Value == 0 {
		if _, err := s.db.Exec(`DELETE FROM profile_comment_votes WHERE comment_id = ? AND user_id = ?`, rawCommentID, user.ID); err != nil {
			httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
			return
		}
	} else {
		if _, err := s.db.Exec(
			`INSERT INTO profile_comment_votes (comment_id, user_id, value, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?)
			 ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)`,
			rawCommentID, user.ID, req.Value, now, now,
		); err != nil {
			httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
			return
		}
	}
	var likeCount, dislikeCount int
	if err := s.db.QueryRow(
		`SELECT
			COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0)
		 FROM profile_comment_votes
		 WHERE comment_id = ?`,
		rawCommentID,
	).Scan(&likeCount, &dislikeCount); err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"comment_id":    commentID,
		"like_count":    likeCount,
		"dislike_count": dislikeCount,
		"my_vote":       req.Value,
	})
}
