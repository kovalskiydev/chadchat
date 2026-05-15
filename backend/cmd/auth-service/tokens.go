package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"os"
	"time"

	"backend/internal/httputil"

	"github.com/golang-jwt/jwt/v5"
)

func (s *Server) respondWithTokens(w http.ResponseWriter, user *User) {
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

func (s *Server) issueTokens(userID string) (*tokenPair, error) {
	now := time.Now().UTC()
	accessToken, err := signToken("acc", userID, now.Add(accessTokenTTL), s.accessKey)
	if err != nil {
		return nil, err
	}
	refreshToken, err := signToken("ref", userID, now.Add(refreshTokenTTL), s.refreshKey)
	if err != nil {
		return nil, err
	}
	if _, err := s.db.Exec(
		`INSERT INTO refresh_sessions (token_hash, user_id, expires_at, revoked_at, created_at)
		 VALUES (?, ?, ?, NULL, ?)`,
		hexSHA256(refreshToken), userID, now.Add(refreshTokenTTL), now,
	); err != nil {
		return nil, err
	}
	return &tokenPair{AccessToken: accessToken, RefreshToken: refreshToken}, nil
}

func (s *Server) verifyAccessToken(token string) (string, error) {
	return verifyToken("acc", token, s.accessKey)
}

func (s *Server) verifyRefreshToken(token string) (string, error) {
	return verifyToken("ref", token, s.refreshKey)
}

func signToken(kind, userID string, exp time.Time, key []byte) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": userID,
		"typ": kind,
		"iss": "auth-service",
		"iat": time.Now().UTC().Unix(),
		"exp": exp.Unix(),
		"jti": randomTokenID(),
	})
	return token.SignedString(key)
}

func verifyToken(kind, tokenString string, key []byte) (string, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (any, error) {
		if token.Method == nil || token.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, errors.New("unexpected_signing_method")
		}
		return key, nil
	})
	if err != nil || !token.Valid {
		return "", errors.New("invalid_token")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", errors.New("invalid_claims")
	}
	claimType, ok := claims["typ"].(string)
	if !ok || claimType != kind {
		return "", errors.New("invalid_token_type")
	}
	sub, ok := claims["sub"].(string)
	if !ok || sub == "" {
		return "", errors.New("missing_subject")
	}
	return sub, nil
}

func hexSHA256(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func randomTokenID() string {
	buf := make([]byte, 16)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}

func secretOrRandom(key string) []byte {
	if value := os.Getenv(key); value != "" {
		return []byte(value)
	}
	buf := make([]byte, 32)
	_, _ = rand.Read(buf)
	log.Printf("warning: %s is not set, tokens will be invalidated on restart", key)
	return buf
}
