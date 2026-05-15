package main

import (
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func normalizeNickname(n string) string { return strings.ToLower(strings.TrimSpace(n)) }

func normalizeUserRole(role string) string {
	switch strings.TrimSpace(strings.ToLower(role)) {
	case userRoleAdmin:
		return userRoleAdmin
	default:
		return userRoleUser
	}
}

func validateNickname(n string) (string, error) {
	nn := normalizeNickname(n)
	if len(nn) < 3 || len(nn) > 24 {
		return "", errors.New("invalid_nickname")
	}
	for _, r := range nn {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '_' && r != '-' {
			return "", errors.New("invalid_nickname")
		}
	}
	return nn, nil
}

func validatePassword(password string) error {
	if len(password) < 8 {
		return errors.New("weak_password")
	}
	return nil
}

func hashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func verifyPassword(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

func publicUserID(rawID int64) string {
	return fmt.Sprintf("u_%d", rawID)
}

func internalUserID(publicID string) (int64, error) {
	if !strings.HasPrefix(publicID, "u_") {
		return 0, errors.New("invalid_public_user_id")
	}
	return strconv.ParseInt(strings.TrimPrefix(publicID, "u_"), 10, 64)
}

func generateAnonymousNickname(rawID int64) string {
	return fmt.Sprintf("anonymys #%d", rawID)
}

func isDuplicateErr(err error) bool {
	return strings.Contains(strings.ToLower(err.Error()), "duplicate")
}

func (s *Server) findUserByID(id string) (*User, error) {
	rawID, err := internalUserID(id)
	if err != nil {
		return nil, err
	}

	var user User
	var nickname, passwordHash sql.NullString
	var createdAt, updatedAt time.Time
	var userType, role, verificationStatus string
	err = s.db.QueryRow(
		`SELECT nickname, password_hash, type, role, verification_status, created_at, updated_at
		 FROM users WHERE id = ?`,
		rawID,
	).Scan(&nickname, &passwordHash, &userType, &role, &verificationStatus, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}

	user = User{
		ID:                 id,
		Nickname:           nickname.String,
		PasswordHash:       passwordHash.String,
		Type:               userType,
		Role:               normalizeUserRole(role),
		VerificationStatus: verificationStatus,
		CreatedAt:          createdAt,
		UpdatedAt:          updatedAt,
	}
	return &user, nil
}

func (s *Server) findUserByNickname(nickname string) (*User, error) {
	var rawID int64
	var nick, passwordHash sql.NullString
	var userType, role, verificationStatus string
	var createdAt, updatedAt time.Time
	err := s.db.QueryRow(
		`SELECT id, nickname, password_hash, type, role, verification_status, created_at, updated_at
		 FROM users WHERE nickname = ?`,
		nickname,
	).Scan(&rawID, &nick, &passwordHash, &userType, &role, &verificationStatus, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	user := &User{
		ID:                 publicUserID(rawID),
		Nickname:           nick.String,
		PasswordHash:       passwordHash.String,
		Type:               userType,
		Role:               normalizeUserRole(role),
		VerificationStatus: verificationStatus,
		CreatedAt:          createdAt,
		UpdatedAt:          updatedAt,
	}
	return user, nil
}
