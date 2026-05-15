package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"backend/internal/httputil"
)

func (s *Server) handleAdminUpsertResultSound(w http.ResponseWriter, r *http.Request) {
	var req adminUpsertSoundRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.ID = strings.TrimSpace(req.ID)
	req.Title = strings.TrimSpace(req.Title)
	req.AudioURL = strings.TrimSpace(req.AudioURL)
	if req.ID == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_id")
		return
	}
	if req.Title == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_title")
		return
	}
	if req.AudioURL == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_audio_url")
		return
	}

	now := time.Now().UTC()
	tx, err := s.db.Begin()
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer tx.Rollback()

	if req.IsDefault {
		if _, err := tx.Exec(`UPDATE result_sounds SET is_default = 0 WHERE is_default = 1`); err != nil {
			httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
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
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	if err := tx.Commit(); err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	sound, err := s.loadSoundByID(req.ID)
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"sound": sound})
}

func (s *Server) handleAdminGrantResultSound(w http.ResponseWriter, r *http.Request) {
	var req adminGrantSoundRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.UserID = strings.TrimSpace(req.UserID)
	req.SoundID = strings.TrimSpace(req.SoundID)
	req.Source = strings.TrimSpace(req.Source)
	if req.UserID == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_user_id")
		return
	}
	if req.SoundID == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_sound_id")
		return
	}
	if req.Source == "" {
		req.Source = "admin"
	}

	if _, err := s.loadSoundByID(req.SoundID); err != nil {
		if err == sql.ErrNoRows {
			httputil.WriteErr(w, http.StatusNotFound, "sound_not_found")
			return
		}
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	now := time.Now().UTC()
	if _, err := s.db.Exec(
		`INSERT INTO user_result_sounds (user_id, sound_id, unlocked_at, source)
		 VALUES (?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE unlocked_at = VALUES(unlocked_at), source = VALUES(source)`,
		req.UserID, req.SoundID, now, req.Source,
	); err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"status":   "granted",
		"user_id":  req.UserID,
		"sound_id": req.SoundID,
		"source":   req.Source,
	})
}

func (s *Server) handleInternalResultSound(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Customization-Internal-Secret") != s.internalSecret {
		httputil.WriteErr(w, http.StatusForbidden, "forbidden")
		return
	}
	userID := strings.TrimSpace(r.PathValue("userID"))
	if userID == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_user_id")
		return
	}
	sound, err := s.activeSoundForUser(userID)
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"sound": sound})
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
	if err != sql.ErrNoRows {
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
	if err == sql.ErrNoRows {
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
