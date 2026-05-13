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

const (
	chatItemTypeTitle         = "title"
	chatItemTypeNicknameColor = "nickname_color"
	chatItemTypeTextStyle     = "text_style"
	chatItemTypeTitleFrame    = "title_frame"
	chatItemTypeAvatar        = "avatar"
	chatItemTypeBadge         = "badge"
)

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

type ChatCustomizationItem struct {
	ID           string          `json:"id"`
	Type         string          `json:"type"`
	Title        string          `json:"title"`
	Description  string          `json:"description"`
	Rarity       string          `json:"rarity"`
	Owned        bool            `json:"owned"`
	LockedReason *string         `json:"locked_reason"`
	PriceAura    int             `json:"price_aura"`
	Preview      json.RawMessage `json:"preview"`
	IsActive     bool            `json:"-"`
	IsDefault    bool            `json:"-"`
	CreatedAt    time.Time       `json:"-"`
}

type chatCatalogResponse struct {
	Titles         []ChatCustomizationItem `json:"titles"`
	NicknameColors []ChatCustomizationItem `json:"nickname_colors"`
	TextStyles     []ChatCustomizationItem `json:"text_styles"`
	TitleFrames    []ChatCustomizationItem `json:"title_frames"`
	Avatars        []ChatCustomizationItem `json:"avatars"`
	Badges         []ChatCustomizationItem `json:"badges"`
}

type chatSelection struct {
	TitleID         string   `json:"title_id,omitempty"`
	NicknameColorID string   `json:"nickname_color_id,omitempty"`
	TextStyleID     string   `json:"text_style_id,omitempty"`
	TitleFrameID    string   `json:"title_frame_id,omitempty"`
	AvatarID        string   `json:"avatar_id,omitempty"`
	BadgeIDs        []string `json:"badge_ids"`
}

type selectChatItemRequest struct {
	Slot   string `json:"slot"`
	ItemID string `json:"item_id"`
}

type clearChatSlotRequest struct {
	Slot string `json:"slot"`
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

type adminUpsertChatItemRequest struct {
	ID          string          `json:"id"`
	Type        string          `json:"type"`
	Title       string          `json:"title"`
	Description string          `json:"description"`
	Rarity      string          `json:"rarity"`
	PriceAura   int             `json:"price_aura"`
	Preview     json.RawMessage `json:"preview"`
	IsActive    bool            `json:"is_active"`
	IsDefault   bool            `json:"is_default"`
}

type adminGrantChatItemRequest struct {
	UserID string `json:"user_id"`
	ItemID string `json:"item_id"`
	Source string `json:"source"`
}

type chatStyleSnapshot struct {
	Title    map[string]any   `json:"title"`
	Nickname map[string]any   `json:"nickname"`
	Text     map[string]any   `json:"text"`
	Avatar   map[string]any   `json:"avatar"`
	Badges   []map[string]any `json:"badges"`
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
	mux.HandleFunc("GET /chat-customization/catalog", s.withAuth(s.handleChatCustomizationCatalog))
	mux.HandleFunc("GET /chat-customization/me", s.withAuth(s.handleChatCustomizationMe))
	mux.HandleFunc("POST /chat-customization/select", s.withAuth(s.handleChatCustomizationSelect))
	mux.HandleFunc("POST /chat-customization/clear", s.withAuth(s.handleChatCustomizationClear))
	mux.HandleFunc("POST /admin/result-sounds", s.withAdmin(s.handleAdminUpsertResultSound))
	mux.HandleFunc("POST /admin/result-sounds/grant", s.withAdmin(s.handleAdminGrantResultSound))
	mux.HandleFunc("POST /admin/chat-customization/items", s.withAdmin(s.handleAdminUpsertChatItem))
	mux.HandleFunc("POST /admin/chat-customization/grant", s.withAdmin(s.handleAdminGrantChatItem))
	mux.HandleFunc("GET /internal/users/{userID}/result-sound", s.handleInternalResultSound)
	mux.HandleFunc("GET /internal/users/{userID}/chat-style", s.handleInternalChatStyle)

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
		`CREATE TABLE IF NOT EXISTS chat_customization_items (
			id VARCHAR(64) NOT NULL PRIMARY KEY,
			type VARCHAR(32) NOT NULL,
			title VARCHAR(128) NOT NULL,
			description VARCHAR(255) NOT NULL,
			rarity VARCHAR(32) NOT NULL,
			price_aura INT NOT NULL DEFAULT 0,
			preview_json JSON NOT NULL,
			is_active TINYINT(1) NOT NULL DEFAULT 1,
			is_default TINYINT(1) NOT NULL DEFAULT 0,
			created_at DATETIME(6) NOT NULL,
			INDEX idx_chat_customization_items_type_active (type, is_active)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS user_chat_customization_items (
			user_id VARCHAR(64) NOT NULL,
			item_id VARCHAR(64) NOT NULL,
			unlocked_at DATETIME(6) NOT NULL,
			source VARCHAR(32) NOT NULL,
			PRIMARY KEY (user_id, item_id),
			INDEX idx_user_chat_customization_items_user_id (user_id)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS user_chat_customization_selection (
			user_id VARCHAR(64) NOT NULL PRIMARY KEY,
			title_id VARCHAR(64) NULL,
			nickname_color_id VARCHAR(64) NULL,
			text_style_id VARCHAR(64) NULL,
			title_frame_id VARCHAR(64) NULL,
			avatar_id VARCHAR(64) NULL,
			badge_ids_json JSON NOT NULL,
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
	if err != nil {
		return err
	}
	defaultItems := []adminUpsertChatItemRequest{
		{ID: "default_title", Type: chatItemTypeTitle, Title: "Default Title", Description: "Default title", Rarity: "common", PriceAura: 0, Preview: json.RawMessage(`{"label":"","colors":[],"animated":false}`), IsActive: true, IsDefault: true},
		{ID: "default_nickname", Type: chatItemTypeNicknameColor, Title: "Default Nickname", Description: "Default nickname color", Rarity: "common", PriceAura: 0, Preview: json.RawMessage(`{"color":"#F5F5F5","gradient":[],"animated":false,"font_weight":600}`), IsActive: true, IsDefault: true},
		{ID: "default_text", Type: chatItemTypeTextStyle, Title: "Default Text", Description: "Default text style", Rarity: "common", PriceAura: 0, Preview: json.RawMessage(`{"style":"default","color":"#E5E7EB"}`), IsActive: true, IsDefault: true},
		{ID: "default_frame", Type: chatItemTypeTitleFrame, Title: "No Frame", Description: "No frame", Rarity: "common", PriceAura: 0, Preview: json.RawMessage(`{"frame":"none","frame_color":"#00000000"}`), IsActive: true, IsDefault: true},
		{ID: "default_avatar", Type: chatItemTypeAvatar, Title: "Default Avatar", Description: "Default avatar", Rarity: "common", PriceAura: 0, Preview: json.RawMessage(`{"url":"","frame":"none"}`), IsActive: true, IsDefault: true},
		{ID: "verified", Type: chatItemTypeBadge, Title: "Verified", Description: "Verified badge", Rarity: "rare", PriceAura: 0, Preview: json.RawMessage(`{"id":"verified","label":"Verified","color":"#3B82F6","icon":"check"}`), IsActive: true, IsDefault: false},
	}
	for _, item := range defaultItems {
		if _, err := s.db.Exec(
			`INSERT INTO chat_customization_items (id, type, title, description, rarity, price_aura, preview_json, is_active, is_default, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON DUPLICATE KEY UPDATE
			   type = VALUES(type),
			   title = VALUES(title),
			   description = VALUES(description),
			   rarity = VALUES(rarity),
			   price_aura = VALUES(price_aura),
			   preview_json = VALUES(preview_json),
			   is_active = VALUES(is_active),
			   is_default = VALUES(is_default)`,
			item.ID, item.Type, item.Title, item.Description, item.Rarity, item.PriceAura, []byte(item.Preview), item.IsActive, item.IsDefault, now,
		); err != nil {
			return err
		}
	}
	return nil
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

func (s *Server) handleChatCustomizationCatalog(w http.ResponseWriter, _ *http.Request, user authUser) {
	items, err := s.loadChatCustomizationCatalog(user.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleChatCustomizationMe(w http.ResponseWriter, _ *http.Request, user authUser) {
	selected, err := s.loadChatSelection(user.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"selected": selected})
}

func (s *Server) handleChatCustomizationSelect(w http.ResponseWriter, r *http.Request, user authUser) {
	var req selectChatItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.Slot = strings.TrimSpace(req.Slot)
	req.ItemID = strings.TrimSpace(req.ItemID)
	if req.Slot == "" || req.ItemID == "" {
		writeErr(w, http.StatusBadRequest, "missing_slot_or_item")
		return
	}
	item, err := s.loadChatItemByID(req.ItemID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "item_not_found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	if !slotMatchesType(req.Slot, item.Type) {
		writeErr(w, http.StatusBadRequest, "slot_item_type_mismatch")
		return
	}
	owned, err := s.userOwnsChatItem(user.ID, item.ID, item.IsDefault)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	if !owned {
		writeErr(w, http.StatusForbidden, "item_not_owned")
		return
	}
	if err := s.ensureChatSelectionRow(user.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	if item.Type == chatItemTypeBadge {
		selected, err := s.loadChatSelection(user.ID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		if !contains(selected.BadgeIDs, item.ID) {
			selected.BadgeIDs = append(selected.BadgeIDs, item.ID)
		}
		badgesJSON, _ := json.Marshal(selected.BadgeIDs)
		if _, err := s.db.Exec(`UPDATE user_chat_customization_selection SET badge_ids_json = ?, updated_at = ? WHERE user_id = ?`, badgesJSON, time.Now().UTC(), user.ID); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"selected": map[string]any{"badge_ids": selected.BadgeIDs}})
		return
	}
	column := selectionColumnForSlot(req.Slot)
	if column == "" {
		writeErr(w, http.StatusBadRequest, "invalid_slot")
		return
	}
	query := `UPDATE user_chat_customization_selection SET ` + column + ` = ?, updated_at = ? WHERE user_id = ?`
	if _, err := s.db.Exec(query, item.ID, time.Now().UTC(), user.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"selected": map[string]any{column: item.ID}})
}

func (s *Server) handleChatCustomizationClear(w http.ResponseWriter, r *http.Request, user authUser) {
	var req clearChatSlotRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.Slot = strings.TrimSpace(req.Slot)
	if req.Slot == "" {
		writeErr(w, http.StatusBadRequest, "missing_slot")
		return
	}
	if err := s.ensureChatSelectionRow(user.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	if req.Slot == "badge" || req.Slot == "badges" {
		if _, err := s.db.Exec(`UPDATE user_chat_customization_selection SET badge_ids_json = ?, updated_at = ? WHERE user_id = ?`, []byte(`[]`), time.Now().UTC(), user.ID); err != nil {
			writeErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"selected": map[string]any{"badge_ids": []string{}}})
		return
	}
	column := selectionColumnForSlot(req.Slot)
	if column == "" {
		writeErr(w, http.StatusBadRequest, "invalid_slot")
		return
	}
	query := `UPDATE user_chat_customization_selection SET ` + column + ` = NULL, updated_at = ? WHERE user_id = ?`
	if _, err := s.db.Exec(query, time.Now().UTC(), user.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"selected": map[string]any{column: nil}})
}

func (s *Server) handleAdminUpsertChatItem(w http.ResponseWriter, r *http.Request) {
	var req adminUpsertChatItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.ID = strings.TrimSpace(req.ID)
	req.Type = strings.TrimSpace(req.Type)
	req.Title = strings.TrimSpace(req.Title)
	req.Description = strings.TrimSpace(req.Description)
	req.Rarity = strings.TrimSpace(req.Rarity)
	if req.ID == "" || req.Type == "" || req.Title == "" {
		writeErr(w, http.StatusBadRequest, "missing_required_fields")
		return
	}
	if !validChatItemType(req.Type) {
		writeErr(w, http.StatusBadRequest, "invalid_item_type")
		return
	}
	if len(req.Preview) == 0 {
		req.Preview = json.RawMessage(`{}`)
	}
	now := time.Now().UTC()
	if _, err := s.db.Exec(
		`INSERT INTO chat_customization_items (id, type, title, description, rarity, price_aura, preview_json, is_active, is_default, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE
		   type = VALUES(type),
		   title = VALUES(title),
		   description = VALUES(description),
		   rarity = VALUES(rarity),
		   price_aura = VALUES(price_aura),
		   preview_json = VALUES(preview_json),
		   is_active = VALUES(is_active),
		   is_default = VALUES(is_default)`,
		req.ID, req.Type, req.Title, req.Description, req.Rarity, req.PriceAura, []byte(req.Preview), req.IsActive, req.IsDefault, now,
	); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	item, err := s.loadChatItemByID(req.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": item})
}

func (s *Server) handleAdminGrantChatItem(w http.ResponseWriter, r *http.Request) {
	var req adminGrantChatItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.UserID = strings.TrimSpace(req.UserID)
	req.ItemID = strings.TrimSpace(req.ItemID)
	req.Source = strings.TrimSpace(req.Source)
	if req.UserID == "" || req.ItemID == "" {
		writeErr(w, http.StatusBadRequest, "missing_required_fields")
		return
	}
	if req.Source == "" {
		req.Source = "admin"
	}
	if _, err := s.loadChatItemByID(req.ItemID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "item_not_found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	if _, err := s.db.Exec(
		`INSERT INTO user_chat_customization_items (user_id, item_id, unlocked_at, source)
		 VALUES (?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE unlocked_at = VALUES(unlocked_at), source = VALUES(source)`,
		req.UserID, req.ItemID, time.Now().UTC(), req.Source,
	); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "granted", "user_id": req.UserID, "item_id": req.ItemID, "source": req.Source})
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

func (s *Server) handleInternalChatStyle(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Customization-Internal-Secret") != s.internalSecret {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	userID := strings.TrimSpace(r.PathValue("userID"))
	if userID == "" {
		writeErr(w, http.StatusBadRequest, "missing_user_id")
		return
	}
	style, err := s.buildChatStyleSnapshot(userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"chat_style": style})
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

func (s *Server) loadChatCustomizationCatalog(userID string) (*chatCatalogResponse, error) {
	selected, err := s.loadChatSelection(userID)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(
		`SELECT i.id, i.type, i.title, i.description, i.rarity, i.price_aura, i.preview_json, i.is_active, i.is_default, i.created_at,
		        CASE WHEN i.is_default = 1 OR ui.user_id IS NOT NULL THEN 1 ELSE 0 END AS owned
		 FROM chat_customization_items i
		 LEFT JOIN user_chat_customization_items ui
		   ON ui.item_id = i.id AND ui.user_id = ?
		 WHERE i.is_active = 1
		 ORDER BY i.type ASC, i.created_at ASC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &chatCatalogResponse{}
	for rows.Next() {
		var item ChatCustomizationItem
		var owned bool
		if err := rows.Scan(&item.ID, &item.Type, &item.Title, &item.Description, &item.Rarity, &item.PriceAura, &item.Preview, &item.IsActive, &item.IsDefault, &item.CreatedAt, &owned); err != nil {
			return nil, err
		}
		item.Owned = owned
		if !owned {
			reason := "not_owned"
			item.LockedReason = &reason
		}
		appendCatalogItem(out, item, selected)
	}
	return out, rows.Err()
}

func appendCatalogItem(out *chatCatalogResponse, item ChatCustomizationItem, selected chatSelection) {
	switch item.Type {
	case chatItemTypeTitle:
		out.Titles = append(out.Titles, item)
	case chatItemTypeNicknameColor:
		out.NicknameColors = append(out.NicknameColors, item)
	case chatItemTypeTextStyle:
		out.TextStyles = append(out.TextStyles, item)
	case chatItemTypeTitleFrame:
		out.TitleFrames = append(out.TitleFrames, item)
	case chatItemTypeAvatar:
		out.Avatars = append(out.Avatars, item)
	case chatItemTypeBadge:
		out.Badges = append(out.Badges, item)
	}
}

func (s *Server) loadChatSelection(userID string) (chatSelection, error) {
	var sel chatSelection
	var badgesRaw []byte
	if err := s.ensureChatSelectionRow(userID); err != nil {
		return sel, err
	}
	err := s.db.QueryRow(
		`SELECT COALESCE(title_id, ''), COALESCE(nickname_color_id, ''), COALESCE(text_style_id, ''),
		        COALESCE(title_frame_id, ''), COALESCE(avatar_id, ''), badge_ids_json
		 FROM user_chat_customization_selection WHERE user_id = ?`, userID,
	).Scan(&sel.TitleID, &sel.NicknameColorID, &sel.TextStyleID, &sel.TitleFrameID, &sel.AvatarID, &badgesRaw)
	if err != nil {
		return sel, err
	}
	if len(badgesRaw) == 0 {
		sel.BadgeIDs = []string{}
	} else {
		_ = json.Unmarshal(badgesRaw, &sel.BadgeIDs)
		if sel.BadgeIDs == nil {
			sel.BadgeIDs = []string{}
		}
	}
	return sel, nil
}

func (s *Server) ensureChatSelectionRow(userID string) error {
	_, err := s.db.Exec(
		`INSERT INTO user_chat_customization_selection (user_id, badge_ids_json, updated_at)
		 VALUES (?, ?, ?)
		 ON DUPLICATE KEY UPDATE user_id = user_id`,
		userID, []byte(`[]`), time.Now().UTC(),
	)
	return err
}

func (s *Server) loadChatItemByID(itemID string) (*ChatCustomizationItem, error) {
	row := s.db.QueryRow(
		`SELECT id, type, title, description, rarity, price_aura, preview_json, is_active, is_default, created_at
		 FROM chat_customization_items WHERE id = ?`, itemID,
	)
	var item ChatCustomizationItem
	if err := row.Scan(&item.ID, &item.Type, &item.Title, &item.Description, &item.Rarity, &item.PriceAura, &item.Preview, &item.IsActive, &item.IsDefault, &item.CreatedAt); err != nil {
		return nil, err
	}
	return &item, nil
}

func (s *Server) userOwnsChatItem(userID, itemID string, isDefault bool) (bool, error) {
	if isDefault {
		return true, nil
	}
	var exists int
	err := s.db.QueryRow(`SELECT 1 FROM user_chat_customization_items WHERE user_id = ? AND item_id = ? LIMIT 1`, userID, itemID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (s *Server) buildChatStyleSnapshot(userID string) (*chatStyleSnapshot, error) {
	selected, err := s.loadChatSelection(userID)
	if err != nil {
		return nil, err
	}
	style := &chatStyleSnapshot{
		Title: map[string]any{
			"label":       "",
			"frame":       "none",
			"frame_color": "#00000000",
		},
		Nickname: map[string]any{
			"color":       "#F5F5F5",
			"gradient":    []string{},
			"animated":    false,
			"font_weight": 600,
		},
		Text: map[string]any{
			"style": "default",
			"color": "#E5E7EB",
		},
		Avatar: map[string]any{
			"url":   "",
			"frame": "none",
		},
		Badges: []map[string]any{},
	}
	if selected.TitleID != "" {
		s.mergePreviewInto(style.Title, selected.TitleID)
	}
	if selected.TitleFrameID != "" {
		s.mergePreviewInto(style.Title, selected.TitleFrameID)
	}
	if selected.NicknameColorID != "" {
		s.mergePreviewInto(style.Nickname, selected.NicknameColorID)
	}
	if selected.TextStyleID != "" {
		s.mergePreviewInto(style.Text, selected.TextStyleID)
	}
	if selected.AvatarID != "" {
		s.mergePreviewInto(style.Avatar, selected.AvatarID)
	}
	for _, badgeID := range selected.BadgeIDs {
		item, err := s.loadChatItemByID(badgeID)
		if err != nil {
			continue
		}
		var preview map[string]any
		if json.Unmarshal(item.Preview, &preview) == nil {
			style.Badges = append(style.Badges, preview)
		}
	}
	return style, nil
}

func (s *Server) mergePreviewInto(target map[string]any, itemID string) {
	item, err := s.loadChatItemByID(itemID)
	if err != nil {
		return
	}
	var preview map[string]any
	if err := json.Unmarshal(item.Preview, &preview); err != nil {
		return
	}
	for k, v := range preview {
		target[k] = v
	}
}

func selectionColumnForSlot(slot string) string {
	switch slot {
	case "title":
		return "title_id"
	case "nickname_color":
		return "nickname_color_id"
	case "text_style":
		return "text_style_id"
	case "title_frame":
		return "title_frame_id"
	case "avatar":
		return "avatar_id"
	default:
		return ""
	}
}

func slotMatchesType(slot, itemType string) bool {
	switch slot {
	case "title":
		return itemType == chatItemTypeTitle
	case "nickname_color":
		return itemType == chatItemTypeNicknameColor
	case "text_style":
		return itemType == chatItemTypeTextStyle
	case "title_frame":
		return itemType == chatItemTypeTitleFrame
	case "avatar":
		return itemType == chatItemTypeAvatar
	case "badge", "badges":
		return itemType == chatItemTypeBadge
	default:
		return false
	}
}

func validChatItemType(v string) bool {
	switch v {
	case chatItemTypeTitle, chatItemTypeNicknameColor, chatItemTypeTextStyle, chatItemTypeTitleFrame, chatItemTypeAvatar, chatItemTypeBadge:
		return true
	default:
		return false
	}
}

func contains(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
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
