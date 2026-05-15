package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"backend/internal/httputil"
)

func (s *Server) handleAnonymous(w http.ResponseWriter, r *http.Request) {
	var req struct {
		VerificationToken string `json:"verification_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteErr(w, 400, "invalid_json")
		return
	}
	if req.VerificationToken == "" {
		httputil.WriteErr(w, 400, "verification_required")
		return
	}
	if err := s.consumeVerificationToken(req.VerificationToken); err != nil {
		httputil.WriteErr(w, 401, "invalid_verification_token")
		return
	}

	now := time.Now().UTC()
	tx, err := s.db.Begin()
	if err != nil {
		httputil.WriteErr(w, 500, "db_error")
		return
	}
	defer tx.Rollback()

	res, err := tx.Exec(
		`INSERT INTO users (nickname, password_hash, type, role, verification_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		nil, nil, userTypeAnonymous, userRoleUser, "passed", now, now,
	)
	if err != nil {
		httputil.WriteErr(w, 500, "db_error")
		return
	}

	rawID, err := res.LastInsertId()
	if err != nil {
		httputil.WriteErr(w, 500, "db_error")
		return
	}
	userID := publicUserID(rawID)
	nickname := generateAnonymousNickname(rawID)

	if _, err := tx.Exec(`UPDATE users SET nickname = ? WHERE id = ?`, nickname, rawID); err != nil {
		httputil.WriteErr(w, 500, "db_error")
		return
	}
	if err := tx.Commit(); err != nil {
		httputil.WriteErr(w, 500, "db_error")
		return
	}

	user := &User{
		ID:                 userID,
		Nickname:           nickname,
		Type:               userTypeAnonymous,
		Role:               userRoleUser,
		VerificationStatus: "passed",
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	s.respondWithTokens(w, user)
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req credentialsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteErr(w, 400, "invalid_json")
		return
	}
	nick, err := validateNickname(req.Nickname)
	if err != nil {
		httputil.WriteErr(w, 400, err.Error())
		return
	}
	if err := validatePassword(req.Password); err != nil {
		httputil.WriteErr(w, 400, err.Error())
		return
	}
	if req.VerificationToken == "" {
		httputil.WriteErr(w, 400, "verification_required")
		return
	}
	if err := s.consumeVerificationToken(req.VerificationToken); err != nil {
		httputil.WriteErr(w, 401, "invalid_verification_token")
		return
	}

	hash, err := hashPassword(req.Password)
	if err != nil {
		httputil.WriteErr(w, 500, "hash_failed")
		return
	}

	now := time.Now().UTC()
	res, err := s.db.Exec(
		`INSERT INTO users (nickname, password_hash, type, role, verification_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		nick, hash, userTypeRegistered, userRoleUser, "passed", now, now,
	)
	if err != nil {
		if isDuplicateErr(err) {
			httputil.WriteErr(w, 409, "nickname_taken")
			return
		}
		httputil.WriteErr(w, 500, "db_error")
		return
	}
	rawID, err := res.LastInsertId()
	if err != nil {
		httputil.WriteErr(w, 500, "db_error")
		return
	}
	user := &User{
		ID:                 publicUserID(rawID),
		Nickname:           nick,
		PasswordHash:       hash,
		Type:               userTypeRegistered,
		Role:               userRoleUser,
		VerificationStatus: "passed",
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	s.respondWithTokens(w, user)
}

func (s *Server) handleUpgrade(w http.ResponseWriter, r *http.Request, user *User) {
	if user.Type != userTypeAnonymous {
		httputil.WriteErr(w, 400, "already_registered")
		return
	}

	var req credentialsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteErr(w, 400, "invalid_json")
		return
	}
	nick, err := validateNickname(req.Nickname)
	if err != nil {
		httputil.WriteErr(w, 400, err.Error())
		return
	}
	if err := validatePassword(req.Password); err != nil {
		httputil.WriteErr(w, 400, err.Error())
		return
	}
	hash, err := hashPassword(req.Password)
	if err != nil {
		httputil.WriteErr(w, 500, "hash_failed")
		return
	}

	now := time.Now().UTC()
	rawID, err := internalUserID(user.ID)
	if err != nil {
		httputil.WriteErr(w, 400, "invalid_user_id")
		return
	}

	_, err = s.db.Exec(
		`UPDATE users
		 SET nickname = ?, password_hash = ?, type = ?, verification_status = ?, updated_at = ?
		 WHERE id = ? AND type = ?`,
		nick, hash, userTypeRegistered, "passed", now, rawID, userTypeAnonymous,
	)
	if err != nil {
		if isDuplicateErr(err) {
			httputil.WriteErr(w, 409, "nickname_taken")
			return
		}
		httputil.WriteErr(w, 500, "db_error")
		return
	}

	user.Nickname = nick
	user.PasswordHash = hash
	user.Type = userTypeRegistered
	user.VerificationStatus = "passed"
	user.UpdatedAt = now

	tokens, err := s.issueTokens(user.ID)
	if err != nil {
		httputil.WriteErr(w, 500, "token_issue_failed")
		return
	}
	httputil.WriteJSON(w, 200, authResponse{
		User:         user,
		AccessToken:  tokens.AccessToken,
		RefreshToken: tokens.RefreshToken,
		ExpiresInSec: int64(accessTokenTTL / time.Second),
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req credentialsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteErr(w, 400, "invalid_json")
		return
	}

	user, err := s.findUserByNickname(normalizeNickname(req.Nickname))
	if err != nil {
		httputil.WriteErr(w, 401, "invalid_credentials")
		return
	}
	if !verifyPassword(req.Password, user.PasswordHash) {
		httputil.WriteErr(w, 401, "invalid_credentials")
		return
	}

	s.respondWithTokens(w, user)
}

func (s *Server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteErr(w, 400, "invalid_json")
		return
	}
	uid, err := s.verifyRefreshToken(req.RefreshToken)
	if err != nil {
		httputil.WriteErr(w, 401, "invalid_refresh_token")
		return
	}

	tokenHash := hexSHA256(req.RefreshToken)
	var session RefreshSession
	var revokedAt sql.NullTime
	err = s.db.QueryRow(
		`SELECT token_hash, user_id, expires_at, revoked_at
		 FROM refresh_sessions WHERE token_hash = ?`,
		tokenHash,
	).Scan(&session.TokenHash, &session.UserID, &session.ExpiresAt, &revokedAt)
	if err != nil || session.UserID != uid || revokedAt.Valid || session.ExpiresAt.Before(time.Now().UTC()) {
		httputil.WriteErr(w, 401, "invalid_refresh_token")
		return
	}

	now := time.Now().UTC()
	if _, err := s.db.Exec(`UPDATE refresh_sessions SET revoked_at = ? WHERE token_hash = ?`, now, tokenHash); err != nil {
		httputil.WriteErr(w, 500, "db_error")
		return
	}

	user, err := s.findUserByID(uid)
	if err != nil {
		httputil.WriteErr(w, 401, "invalid_refresh_token")
		return
	}

	tokens, err := s.issueTokens(uid)
	if err != nil {
		httputil.WriteErr(w, 500, "token_issue_failed")
		return
	}

	httputil.WriteJSON(w, 200, authResponse{
		User:         user,
		AccessToken:  tokens.AccessToken,
		RefreshToken: tokens.RefreshToken,
		ExpiresInSec: int64(accessTokenTTL / time.Second),
	})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteErr(w, 400, "invalid_json")
		return
	}

	now := time.Now().UTC()
	_, _ = s.db.Exec(`UPDATE refresh_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`, now, hexSHA256(req.RefreshToken))
	httputil.WriteJSON(w, 200, map[string]string{"status": "ok"})
}

func (s *Server) handleMe(w http.ResponseWriter, _ *http.Request, user *User) {
	httputil.WriteJSON(w, 200, map[string]*User{"user": user})
}

func (s *Server) consumeVerificationToken(token string) error {
	payload, _ := json.Marshal(map[string]string{"verification_token": token})
	req, err := http.NewRequest(http.MethodPost, s.verificationBaseURL+"/verification/consume", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Verification-Secret", s.verificationSecret)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return errors.New("consume_failed")
	}
	return nil
}
