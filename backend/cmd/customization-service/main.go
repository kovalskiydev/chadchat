package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"backend/internal/httputil"
	"backend/internal/mysqlutil"
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
		authServiceURL: httputil.EnvOr("AUTH_SERVICE_URL", "http://localhost:8081"),
		internalSecret: httputil.EnvOr("CUSTOMIZATION_INTERNAL_SECRET", "dev-customization-secret-change-me"),
		adminSecret:    httputil.EnvOr("ADMIN_API_SECRET", "dev-admin-secret-change-me"),
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

	addr := ":" + httputil.EnvOr("PORT", "8087")
	log.Printf("customization-service on %s", addr)
	log.Fatal(http.ListenAndServe(addr, httputil.WithJSON(mux)))
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
		httputil.EnvOr("DEFAULT_RESULT_SOUND_URL", "https://cdn.chadchat.example/sounds/default_win.mp3"),
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
		httputil.WriteJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "status": "degraded", "error": "mysql_unavailable"})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "status": "ok", "checks": map[string]string{"mysql": "ok"}})
}

func (s *Server) withAuth(next func(http.ResponseWriter, *http.Request, authUser)) http.HandlerFunc {
	return httputil.WithAuth(s.authServiceURL, func(w http.ResponseWriter, r *http.Request, u httputil.User) {
		next(w, r, authUser{ID: u.ID, Nickname: u.Nickname})
	})
}

func (s *Server) withAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Admin-Secret") != s.adminSecret {
			httputil.WriteErr(w, http.StatusForbidden, "forbidden")
			return
		}
		next(w, r)
	}
}
