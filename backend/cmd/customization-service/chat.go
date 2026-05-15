package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"backend/internal/httputil"
)

func (s *Server) handleAdminUpsertChatItem(w http.ResponseWriter, r *http.Request) {
	var req adminUpsertChatItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.ID = strings.TrimSpace(req.ID)
	req.Type = strings.TrimSpace(req.Type)
	req.Title = strings.TrimSpace(req.Title)
	req.Description = strings.TrimSpace(req.Description)
	req.Rarity = strings.TrimSpace(req.Rarity)
	if req.ID == "" || req.Type == "" || req.Title == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_required_fields")
		return
	}
	if !validChatItemType(req.Type) {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_item_type")
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
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	item, err := s.loadChatItemByID(req.ID)
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"item": item})
}

func (s *Server) handleAdminGrantChatItem(w http.ResponseWriter, r *http.Request) {
	var req adminGrantChatItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.UserID = strings.TrimSpace(req.UserID)
	req.ItemID = strings.TrimSpace(req.ItemID)
	req.Source = strings.TrimSpace(req.Source)
	if req.UserID == "" || req.ItemID == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_required_fields")
		return
	}
	if req.Source == "" {
		req.Source = "admin"
	}
	if _, err := s.loadChatItemByID(req.ItemID); err != nil {
		if err == sql.ErrNoRows {
			httputil.WriteErr(w, http.StatusNotFound, "item_not_found")
			return
		}
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	if _, err := s.db.Exec(
		`INSERT INTO user_chat_customization_items (user_id, item_id, unlocked_at, source)
		 VALUES (?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE unlocked_at = VALUES(unlocked_at), source = VALUES(source)`,
		req.UserID, req.ItemID, time.Now().UTC(), req.Source,
	); err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"status": "granted", "user_id": req.UserID, "item_id": req.ItemID, "source": req.Source})
}

func (s *Server) handleInternalChatStyle(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Customization-Internal-Secret") != s.internalSecret {
		httputil.WriteErr(w, http.StatusForbidden, "forbidden")
		return
	}
	userID := strings.TrimSpace(r.PathValue("userID"))
	if userID == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_user_id")
		return
	}
	style, err := s.buildChatStyleSnapshot(userID)
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"chat_style": style})
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
	if err == sql.ErrNoRows {
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
		if item, err := s.loadChatItemByID(selected.TitleID); err == nil {
			var preview map[string]any
			if json.Unmarshal(item.Preview, &preview) == nil {
				style.Title = preview
			}
		}
	}
	if selected.NicknameColorID != "" {
		if item, err := s.loadChatItemByID(selected.NicknameColorID); err == nil {
			var preview map[string]any
			if json.Unmarshal(item.Preview, &preview) == nil {
				style.Nickname = preview
			}
		}
	}
	if selected.TextStyleID != "" {
		if item, err := s.loadChatItemByID(selected.TextStyleID); err == nil {
			var preview map[string]any
			if json.Unmarshal(item.Preview, &preview) == nil {
				style.Text = preview
			}
		}
	}
	if selected.TitleFrameID != "" {
		if item, err := s.loadChatItemByID(selected.TitleFrameID); err == nil {
			var preview map[string]any
			if json.Unmarshal(item.Preview, &preview) == nil {
				if frameColor, ok := preview["frame_color"].(string); ok {
					style.Title["frame_color"] = frameColor
				}
				if frame, ok := preview["frame"].(string); ok {
					style.Title["frame"] = frame
				}
			}
		}
	}
	if selected.AvatarID != "" {
		if item, err := s.loadChatItemByID(selected.AvatarID); err == nil {
			var preview map[string]any
			if json.Unmarshal(item.Preview, &preview) == nil {
				style.Avatar = preview
			}
		}
	}
	for _, badgeID := range selected.BadgeIDs {
		if item, err := s.loadChatItemByID(badgeID); err == nil {
			var preview map[string]any
			if json.Unmarshal(item.Preview, &preview) == nil {
				style.Badges = append(style.Badges, preview)
			}
		}
	}
	return style, nil
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

func validChatItemType(t string) bool {
	switch t {
	case chatItemTypeTitle, chatItemTypeNicknameColor, chatItemTypeTextStyle, chatItemTypeTitleFrame, chatItemTypeAvatar, chatItemTypeBadge:
		return true
	default:
		return false
	}
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}
