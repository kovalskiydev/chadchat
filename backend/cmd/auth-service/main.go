package main

import (
	"database/sql"
	"log"
	"net/http"
	"strings"
	"time"

	"backend/internal/httputil"
	"backend/internal/mysqlutil"
	"backend/internal/rateutil"
)

const (
	userTypeAnonymous  = "anonymous"
	userTypeRegistered = "registered"
	userRoleUser       = "user"
	userRoleAdmin      = "admin"
	accessTokenTTL     = 15 * time.Minute
	refreshTokenTTL    = 30 * 24 * time.Hour
)

type User struct {
	ID                 string    `json:"id"`
	Nickname           string    `json:"nickname,omitempty"`
	PasswordHash       string    `json:"-"`
	Type               string    `json:"type"`
	Role               string    `json:"role"`
	VerificationStatus string    `json:"verification_status"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

type RefreshSession struct {
	TokenHash string
	UserID    string
	ExpiresAt time.Time
	RevokedAt *time.Time
}

type Server struct {
	db                  *sql.DB
	accessKey           []byte
	refreshKey          []byte
	verificationBaseURL string
	verificationSecret  string
	limiter             *rateutil.Limiter
}

type credentialsRequest struct {
	Nickname          string `json:"nickname"`
	Password          string `json:"password"`
	VerificationToken string `json:"verification_token"`
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type authResponse struct {
	User         *User  `json:"user"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresInSec int64  `json:"expires_in_sec"`
}

type tokenPair struct {
	AccessToken  string
	RefreshToken string
}

func main() {
	db, err := mysqlutil.OpenFromEnv()
	if err != nil {
		log.Fatalf("open mysql: %v", err)
	}

	if err := mysqlutil.ExecStatements(db, authSchema()); err != nil {
		log.Fatalf("auth schema: %v", err)
	}
	if err := ensureAuthSchema(db); err != nil {
		log.Fatalf("auth schema: %v", err)
	}

	s := &Server{
		db:                  db,
		accessKey:           secretOrRandom("AUTH_ACCESS_TOKEN_SECRET"),
		refreshKey:          secretOrRandom("AUTH_REFRESH_TOKEN_SECRET"),
		verificationBaseURL: httputil.EnvOr("VERIFICATION_SERVICE_URL", "http://localhost:8082"),
		verificationSecret:  httputil.EnvOr("VERIFICATION_INTERNAL_SECRET", "dev-internal-secret-change-me"),
		limiter:             rateutil.NewLimiter(),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("POST /auth/anonymous", s.withRateLimit(10, time.Minute, s.handleAnonymous))
	mux.HandleFunc("POST /auth/register", s.withRateLimit(10, time.Minute, s.handleRegister))
	mux.HandleFunc("POST /auth/login", s.withRateLimit(20, time.Minute, s.handleLogin))
	mux.HandleFunc("POST /auth/upgrade", s.withRateLimit(10, time.Minute, s.withAuth(s.handleUpgrade)))
	mux.HandleFunc("POST /auth/refresh", s.withRateLimit(60, time.Minute, s.handleRefresh))
	mux.HandleFunc("POST /auth/logout", s.withRateLimit(60, time.Minute, s.handleLogout))
	mux.HandleFunc("GET /me", s.withAuth(s.handleMe))

	addr := ":" + httputil.EnvOr("PORT", "8081")
	log.Printf("auth-service on %s", addr)
	log.Fatal(http.ListenAndServe(addr, httputil.WithJSON(mux)))
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
		"checks": map[string]string{
			"mysql": "ok",
		},
	})
}

func authSchema() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS users (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
			nickname VARCHAR(64) NULL UNIQUE,
			password_hash VARCHAR(255) NULL,
			type VARCHAR(32) NOT NULL,
			role VARCHAR(32) NOT NULL DEFAULT 'user',
			verification_status VARCHAR(32) NOT NULL,
			created_at DATETIME(6) NOT NULL,
			updated_at DATETIME(6) NOT NULL
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS refresh_sessions (
			token_hash CHAR(64) NOT NULL PRIMARY KEY,
			user_id VARCHAR(64) NOT NULL,
			expires_at DATETIME(6) NOT NULL,
			revoked_at DATETIME(6) NULL,
			created_at DATETIME(6) NOT NULL,
			INDEX idx_refresh_user_id (user_id)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
	}
}

func ensureAuthSchema(db *sql.DB) error {
	hasRole, err := mysqlutil.ColumnExists(db, "users", "role")
	if err != nil {
		return err
	}
	if !hasRole {
		if _, err := db.Exec(`ALTER TABLE users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'user' AFTER type`); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) withAuth(next func(http.ResponseWriter, *http.Request, *User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			httputil.WriteErr(w, 401, "missing_bearer_token")
			return
		}
		userID, err := s.verifyAccessToken(strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer ")))
		if err != nil {
			httputil.WriteErr(w, 401, "invalid_access_token")
			return
		}
		user, err := s.findUserByID(userID)
		if err != nil {
			httputil.WriteErr(w, 401, "invalid_access_token")
			return
		}
		next(w, r, user)
	}
}

func (s *Server) withRateLimit(limit int, window time.Duration, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := r.Method + ":" + r.URL.Path + ":" + rateutil.ClientKey(r)
		if !s.limiter.Allow(key, limit, window) {
			httputil.WriteErr(w, http.StatusTooManyRequests, "rate_limited")
			return
		}
		next(w, r)
	}
}
