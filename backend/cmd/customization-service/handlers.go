package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"backend/internal/httputil"
)

func (s *Server) handleListResultSounds(w http.ResponseWriter, _ *http.Request, user authUser) {
	selectedID, err := s.selectedSoundID(user.ID)
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
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
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	defer rows.Close()

	sounds := make([]ResultSound, 0)
	for rows.Next() {
		var sound ResultSound
		var owned bool
		if err := rows.Scan(&sound.ID, &sound.Title, &sound.AudioURL, &sound.IsDefault, &sound.CreatedAt, &owned); err != nil {
			httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		sound.Owned = owned
		sound.Selected = sound.ID == selectedID
		sounds = append(sounds, sound)
	}
	if err := rows.Err(); err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"sounds": sounds})
}

func (s *Server) handleSelectResultSound(w http.ResponseWriter, r *http.Request, user authUser) {
	var req selectResultSoundRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.SoundID = strings.TrimSpace(req.SoundID)
	if req.SoundID == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_sound_id")
		return
	}
	sound, err := s.loadOwnedSound(user.ID, req.SoundID)
	if err != nil {
		if err == sql.ErrNoRows {
			httputil.WriteErr(w, http.StatusForbidden, "sound_not_owned")
			return
		}
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}

	now := time.Now().UTC()
	if _, err := s.db.Exec(
		`INSERT INTO user_result_sound_settings (user_id, selected_sound_id, updated_at)
		 VALUES (?, ?, ?)
		 ON DUPLICATE KEY UPDATE selected_sound_id = VALUES(selected_sound_id), updated_at = VALUES(updated_at)`,
		user.ID, sound.ID, now,
	); err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	sound.Owned = true
	sound.Selected = true
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"sound": sound})
}

func (s *Server) handleChatCustomizationCatalog(w http.ResponseWriter, _ *http.Request, user authUser) {
	items, err := s.loadChatCustomizationCatalog(user.ID)
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, items)
}

func (s *Server) handleChatCustomizationMe(w http.ResponseWriter, _ *http.Request, user authUser) {
	selected, err := s.loadChatSelection(user.ID)
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"selected": selected})
}

func (s *Server) handleChatCustomizationSelect(w http.ResponseWriter, r *http.Request, user authUser) {
	var req selectChatItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.Slot = strings.TrimSpace(req.Slot)
	req.ItemID = strings.TrimSpace(req.ItemID)
	if req.Slot == "" || req.ItemID == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_slot_or_item")
		return
	}
	item, err := s.loadChatItemByID(req.ItemID)
	if err != nil {
		if err == sql.ErrNoRows {
			httputil.WriteErr(w, http.StatusNotFound, "item_not_found")
			return
		}
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	if !slotMatchesType(req.Slot, item.Type) {
		httputil.WriteErr(w, http.StatusBadRequest, "slot_item_type_mismatch")
		return
	}
	owned, err := s.userOwnsChatItem(user.ID, item.ID, item.IsDefault)
	if err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	if !owned {
		httputil.WriteErr(w, http.StatusForbidden, "item_not_owned")
		return
	}
	if err := s.ensureChatSelectionRow(user.ID); err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	if item.Type == chatItemTypeBadge {
		selected, err := s.loadChatSelection(user.ID)
		if err != nil {
			httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		if !contains(selected.BadgeIDs, item.ID) {
			selected.BadgeIDs = append(selected.BadgeIDs, item.ID)
		}
		badgesJSON, _ := json.Marshal(selected.BadgeIDs)
		if _, err := s.db.Exec(`UPDATE user_chat_customization_selection SET badge_ids_json = ?, updated_at = ? WHERE user_id = ?`, badgesJSON, time.Now().UTC(), user.ID); err != nil {
			httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		httputil.WriteJSON(w, http.StatusOK, map[string]any{"selected": map[string]any{"badge_ids": selected.BadgeIDs}})
		return
	}
	column := selectionColumnForSlot(req.Slot)
	if column == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_slot")
		return
	}
	query := `UPDATE user_chat_customization_selection SET ` + column + ` = ?, updated_at = ? WHERE user_id = ?`
	if _, err := s.db.Exec(query, item.ID, time.Now().UTC(), user.ID); err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"selected": map[string]any{column: item.ID}})
}

func (s *Server) handleChatCustomizationClear(w http.ResponseWriter, r *http.Request, user authUser) {
	var req clearChatSlotRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.Slot = strings.TrimSpace(req.Slot)
	if req.Slot == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "missing_slot")
		return
	}
	if err := s.ensureChatSelectionRow(user.ID); err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	if req.Slot == "badge" || req.Slot == "badges" {
		if _, err := s.db.Exec(`UPDATE user_chat_customization_selection SET badge_ids_json = ?, updated_at = ? WHERE user_id = ?`, []byte(`[]`), time.Now().UTC(), user.ID); err != nil {
			httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
			return
		}
		httputil.WriteJSON(w, http.StatusOK, map[string]any{"selected": map[string]any{"badge_ids": []string{}}})
		return
	}
	column := selectionColumnForSlot(req.Slot)
	if column == "" {
		httputil.WriteErr(w, http.StatusBadRequest, "invalid_slot")
		return
	}
	query := `UPDATE user_chat_customization_selection SET ` + column + ` = NULL, updated_at = ? WHERE user_id = ?`
	if _, err := s.db.Exec(query, time.Now().UTC(), user.ID); err != nil {
		httputil.WriteErr(w, http.StatusInternalServerError, "db_error")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"selected": map[string]any{column: nil}})
}
