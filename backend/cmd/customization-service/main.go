package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"backend/internal/mysqlutil"

	_ "github.com/go-sql-driver/mysql"
)

const defaultResultSoundID = "default_win"

type Server struct {
	db             *sql.DB
	authServiceURL string
	internalSecret string
	adminSecret    string
}

type authUser struct {
	ID       string
	Nickname string
}

type meResponse struct {
	User struct {
		ID       string `json:"id"`
		Nickname string `json:"nickname"`
	} `json:"user"`
}

type ResultSound struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	AudioURL  string    `json:"audio_url"`
	IsDefault bool      `json:"is_default"`
	Owned     bool      `json:"owned"`
	Selected  bool      `json:"selected"`
	CreatedAt time.Time `json:"created_at,omitempty"`
}

type selectResultSoundRequest struct {
	SoundID string `json:"sound_id"`
}

type adminUpsertSoundRequest struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	AudioURL  string `json:"audio_url"`
	IsDefault bool   `json:"is_default"`
	IsActive  bool   `json:"is_active"`
}

type adminGrantSoundRequest struct {
	UserID  string `json:"user_id"`
	SoundID string `json:"sound_id"`
	Source  string `json:"source"`
}

func main() {
	db, err := mysqlutil.OpenFromEnv()
	if err != nil {
		log.Fatalf("open mysql: %v", err)
	}
	if err := mysqlutil.ExecStatements(db, customizationSchema()); err != nil {
		log.Fatalf("customization schema: %v", err)
	}

	s := &Server{
		db:             db,
		authServiceURL: envOr("AUTH_SERVICE_URL", "http://localhost:8081"),
		internalSecret: envOr("CUSTOMIZATION_INTERNAL_SECRET", "dev-customization-secret-change-me"),
		adminSecret:    envOr("ADMIN_API_SECRET", "dev-admin-secret-change-me"),
	}
	if err := s.seedDefaults(); err != nil {
		log.Fatalf("seed defaults: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /result-sounds", s.withAuth(s.handleListResultSounds))
	mux.HandleFunc("POST /result-sounds/select", s.withAuth(s.handleSelectResultSound))
	mux.HandleFunc("POST /admin/result-sounds", s.withAdmin(s.handleAdminUpsertResultSound))
	mux.HandleFunc("POST /admin/result-sounds/grant", s.withAdmin(s.handleAdminGrantResultSound))
	mux.HandleFunc("GET /internal/users/{userID}/result-sound", s.handleInternalResultSound)

	addr := ":" + envOr("PORT", "8087")
	log.Printf("customization-service on %s", addr)
	log.Fatal(http.ListenAndServe(addr, withJSON(mux)))
}

func customizationSchema() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS result_sounds (
			id VARCHAR(64) NOT NULL PRIMARY KEY,
			title VARCHAR(128) NOT NULL,
			audio_url VARCHAR(512) NOT NULL,
			is_default TINYINT(1) NOT NULL DEFAULT 0,
			is_active TINYINT(1) NOT NULL DEFAULT 1,
			created_at DATETIME(6) NOT NULL
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS user_result_sounds (
			user_id VARCHAR(64) NOT NULL,
			sound_id VARCHAR(64) NOT NULL,
			unlocked_at DATETIME(6) NOT NULL,
			source VARCHAR(32) NOT NULL,
			PRIMARY KEY (user_id, sound_id),
			INDEX idx_user_result_sounds_user_id (user_id)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS user_result_sound_settings (
			user_id VARCHAR(64) NOT NULL PRIMARY KEY,
			selected_sound_id VARCHAR(64) NOT NULL,
			updated_at DATETIME(6) NOT NULL
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
	}
}

func (s *Server) seedDefaults() error {
	now := time.Now().UTC()
	_, err := s.db.Exec(
		`INSERT INTO result_sounds (id, title, audio_url, is_default, is_active, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE
		   title = VALUES(title),
		   audio_url = VALUES(audio_url),
		   is_default = VALUES(is_default),
		   is_active = VALUES(is_active)`,
		defaultResultSoundID,
		"Default Win",
		envOr("DEFAULT_RESULT_SOUND_URL", "https://cdn.chadchat.example/sounds/default_win.mp3"),
		true,
		true,
		now,
	)
	return err
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

func (s *Server) withAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Admin-Secret") != s.adminSecret {
			writeErr(w, http.StatusForbidden, "forbidden")
			return
		}
		next(w, r)
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

func (s *Server) handleListResultSounds(w http.ResponseWriter, _ *http.Request, user authUser) {
	selectedID, err := s.selectedSoundID(user.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	rows, err := s.db.Query(
		`SELECT rs.id, rs.title, rs.audio_url, rs.is_default, rs.created_at,
		        CASE
		          WHEN rs.is_default = 1 THEN 1
		          WHEN urs.user_id IS NOT NULL THEN 1
		          ELSE 0
		        END AS owned
		 FROM result_sounds rs
		 LEFT JOIN user_result_sounds urs
		   ON urs.sound_id = rs.id AND urs.user_id = ?
		 WHERE rs.is_active = 1
		 ORDER BY rs.is_default DESC, rs.created_at ASC`,
		user.ID,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer rows.Close()

	sounds := make([]ResultSound, 0)
	for rows.Next() {
		var sound ResultSound
		var owned bool
		if err := rows.Scan(&sound.ID, &sound.Title, &sound.AudioURL, &sound.IsDefault, &sound.CreatedAt, &owned); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		sound.Owned = owned
		sound.Selected = sound.ID == selectedID
		sounds = append(sounds, sound)
	}
	if err := rows.Err(); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sounds": sounds})
}

func (s *Server) handleSelectResultSound(w http.ResponseWriter, r *http.Request, user authUser) {
	var req selectResultSoundRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.SoundID = strings.TrimSpace(req.SoundID)
	if req.SoundID == "" {
		writeErr(w, http.StatusBadRequest, "missing_sound_id")
		return
	}
	sound, err := s.loadOwnedSound(user.ID, req.SoundID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeErr(w, http.StatusForbidden, "sound_not_owned")
			return
		}
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	now := time.Now().UTC()
	if _, err := s.db.Exec(
		`INSERT INTO user_result_sound_settings (user_id, selected_sound_id, updated_at)
		 VALUES (?, ?, ?)
		 ON DUPLICATE KEY UPDATE selected_sound_id = VALUES(selected_sound_id), updated_at = VALUES(updated_at)`,
		user.ID, sound.ID, now,
	); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	sound.Owned = true
	sound.Selected = true
	writeJSON(w, http.StatusOK, map[string]any{"sound": sound})
}

func (s *Server) handleAdminUpsertResultSound(w http.ResponseWriter, r *http.Request) {
	var req adminUpsertSoundRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.ID = strings.TrimSpace(req.ID)
	req.Title = strings.TrimSpace(req.Title)
	req.AudioURL = strings.TrimSpace(req.AudioURL)
	if req.ID == "" {
		writeErr(w, http.StatusBadRequest, "missing_id")
		return
	}
	if req.Title == "" {
		writeErr(w, http.StatusBadRequest, "missing_title")
		return
	}
	if req.AudioURL == "" {
		writeErr(w, http.StatusBadRequest, "missing_audio_url")
		return
	}

	now := time.Now().UTC()
	tx, err := s.db.Begin()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer tx.Rollback()

	if req.IsDefault {
		if _, err := tx.Exec(`UPDATE result_sounds SET is_default = 0 WHERE is_default = 1`); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
	}

	if _, err := tx.Exec(
		`INSERT INTO result_sounds (id, title, audio_url, is_default, is_active, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE
		   title = VALUES(title),
		   audio_url = VALUES(audio_url),
		   is_default = VALUES(is_default),
		   is_active = VALUES(is_active)`,
		req.ID, req.Title, req.AudioURL, req.IsDefault, req.IsActive, now,
	); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	if err := tx.Commit(); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	sound, err := s.loadSoundByID(req.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sound": sound})
}

func (s *Server) handleAdminGrantResultSound(w http.ResponseWriter, r *http.Request) {
	var req adminGrantSoundRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.UserID = strings.TrimSpace(req.UserID)
	req.SoundID = strings.TrimSpace(req.SoundID)
	req.Source = strings.TrimSpace(req.Source)
	if req.UserID == "" {
		writeErr(w, http.StatusBadRequest, "missing_user_id")
		return
	}
	if req.SoundID == "" {
		writeErr(w, http.StatusBadRequest, "missing_sound_id")
		return
	}
	if req.Source == "" {
		req.Source = "admin"
	}

	if _, err := s.loadSoundByID(req.SoundID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "sound_not_found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	now := time.Now().UTC()
	if _, err := s.db.Exec(
		`INSERT INTO user_result_sounds (user_id, sound_id, unlocked_at, source)
		 VALUES (?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE unlocked_at = VALUES(unlocked_at), source = VALUES(source)`,
		req.UserID, req.SoundID, now, req.Source,
	); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":   "granted",
		"user_id":  req.UserID,
		"sound_id": req.SoundID,
		"source":   req.Source,
	})
}

func (s *Server) handleInternalResultSound(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Customization-Internal-Secret") != s.internalSecret {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	userID := strings.TrimSpace(r.PathValue("userID"))
	if userID == "" {
		writeErr(w, http.StatusBadRequest, "missing_user_id")
		return
	}
	sound, err := s.activeSoundForUser(userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sound": sound})
}

func (s *Server) activeSoundForUser(userID string) (*ResultSound, error) {
	selectedID, err := s.selectedSoundID(userID)
	if err != nil {
		return nil, err
	}
	sound, err := s.loadOwnedSound(userID, selectedID)
	if err == nil {
		sound.Owned = true
		sound.Selected = true
		return sound, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	return s.loadDefaultSound()
}

func (s *Server) selectedSoundID(userID string) (string, error) {
	var selectedID string
	err := s.db.QueryRow(`SELECT selected_sound_id FROM user_result_sound_settings WHERE user_id = ?`, userID).Scan(&selectedID)
	if err == nil {
		return selectedID, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return defaultResultSoundID, nil
	}
	return "", err
}

func (s *Server) loadOwnedSound(userID, soundID string) (*ResultSound, error) {
	row := s.db.QueryRow(
		`SELECT rs.id, rs.title, rs.audio_url, rs.is_default, rs.created_at
		 FROM result_sounds rs
		 LEFT JOIN user_result_sounds urs
		   ON urs.sound_id = rs.id AND urs.user_id = ?
		 WHERE rs.id = ? AND rs.is_active = 1
		   AND (rs.is_default = 1 OR urs.user_id IS NOT NULL)`,
		userID, soundID,
	)
	var sound ResultSound
	if err := row.Scan(&sound.ID, &sound.Title, &sound.AudioURL, &sound.IsDefault, &sound.CreatedAt); err != nil {
		return nil, err
	}
	return &sound, nil
}

func (s *Server) loadDefaultSound() (*ResultSound, error) {
	row := s.db.QueryRow(
		`SELECT id, title, audio_url, is_default, created_at
		 FROM result_sounds
		 WHERE id = ? AND is_active = 1`,
		defaultResultSoundID,
	)
	var sound ResultSound
	if err := row.Scan(&sound.ID, &sound.Title, &sound.AudioURL, &sound.IsDefault, &sound.CreatedAt); err != nil {
		return nil, err
	}
	sound.Owned = true
	sound.Selected = true
	return &sound, nil
}

func (s *Server) loadSoundByID(soundID string) (*ResultSound, error) {
	row := s.db.QueryRow(
		`SELECT id, title, audio_url, is_default, created_at
		 FROM result_sounds
		 WHERE id = ?`,
		soundID,
	)
	var sound ResultSound
	if err := row.Scan(&sound.ID, &sound.Title, &sound.AudioURL, &sound.IsDefault, &sound.CreatedAt); err != nil {
		return nil, err
	}
	return &sound, nil
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

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
