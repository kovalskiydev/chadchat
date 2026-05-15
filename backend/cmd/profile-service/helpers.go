package main

import (
	"database/sql"
	"encoding/json"
	"time"
)

func (s *Server) loadProfile(userID string, user authUser) (*profileResponse, error) {
	profile := &profileResponse{
		UserID:         userID,
		Nickname:       user.Nickname,
		Type:           user.Type,
		Role:           user.Role,
		MemberSince:    user.CreatedAt,
		AccountAgeDays: int(time.Since(user.CreatedAt).Hours() / 24),
		SelectedBadges: []map[string]any{},
		RecentForm:     []string{},
	}

	var avatarURL, countryCode, bio sql.NullString
	_ = s.db.QueryRow(`SELECT avatar_url, country_code, bio FROM user_profiles WHERE user_id = ?`, userID).Scan(&avatarURL, &countryCode, &bio)
	profile.AvatarURL = avatarURL.String
	profile.CountryCode = countryCode.String
	profile.Bio = bio.String

	var rating, peak sql.NullInt64
	_ = s.db.QueryRow(`SELECT rating, peak_rating FROM user_ratings WHERE user_id = ?`, userID).Scan(&rating, &peak)
	if rating.Valid {
		profile.Rating = int(rating.Int64)
		profile.PeakRating = int(peak.Int64)
	} else {
		profile.Rating = 1500
		profile.PeakRating = 1500
	}
	applyRank(profile)

	rows, err := s.db.Query(
		`SELECT result, rating_delta, my_score, started_at, finished_at
		 FROM user_match_history
		 WHERE user_id = ?
		 ORDER BY finished_at DESC, id DESC`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var scoreSum float64
	var bestScore float64
	var recentScore float64
	var lastMatchAt *time.Time
	var bestWinDelta, worstLossDelta int
	var gainCount, lossCount int
	first := true
	for rows.Next() {
		var result string
		var delta int
		var score float64
		var startedAt, finishedAt time.Time
		if err := rows.Scan(&result, &delta, &score, &startedAt, &finishedAt); err != nil {
			return nil, err
		}
		profile.Matches++
		scoreSum += score
		if score > bestScore {
			bestScore = score
		}
		if first {
			recentScore = score
			lastMatchAt = &finishedAt
			first = false
		}
		switch result {
		case "win":
			profile.Wins++
			if delta > bestWinDelta {
				bestWinDelta = delta
			}
			if profile.Streak >= 0 {
				profile.Streak++
			}
		case "loss":
			profile.Losses++
			if worstLossDelta == 0 || delta < worstLossDelta {
				worstLossDelta = delta
			}
			if profile.Streak <= 0 {
				profile.Streak--
			}
		}
		if len(profile.RecentForm) < 5 {
			profile.RecentForm = append(profile.RecentForm, resultLetter(result))
		}
		if delta > 0 {
			gainCount++
		}
		if delta < 0 {
			lossCount++
		}
	}
	if profile.Matches > 0 {
		profile.WinRate = round2(float64(profile.Wins) * 100 / float64(profile.Matches))
		profile.AverageScore = round2(scoreSum / float64(profile.Matches))
	}
	profile.BestScore = round2(bestScore)
	profile.RecentScore = round2(recentScore)
	profile.LastMatchAt = lastMatchAt
	profile.FavoriteMode = "duel"
	profile.BestWinRatingDelta = bestWinDelta
	profile.WorstLossRatingDelta = worstLossDelta

	_ = s.db.QueryRow(`SELECT COALESCE(AVG(op.rating),0)
		FROM user_match_history umh
		JOIN user_ratings op ON op.user_id = umh.opponent_user_id
		WHERE umh.user_id = ?`, userID).Scan(&profile.AvgOpponentRating)
	profile.AvgOpponentRating = round2(profile.AvgOpponentRating)

	_ = s.db.QueryRow(`SELECT COALESCE(MAX(final_average),0), COALESCE(AVG(final_average),0)
		FROM test_lab_sessions s
		JOIN test_lab_rooms r ON r.id = s.room_id
		WHERE r.owner_id = ? AND s.final_average IS NOT NULL`, userID).Scan(&profile.TestLabBest, &profile.TestLabAverage)
	profile.TestLabBest = round2(profile.TestLabBest)
	profile.TestLabAverage = round2(profile.TestLabAverage)

	if err := s.loadSelectedCosmetics(profile); err != nil {
		return nil, err
	}
	return profile, nil
}

func (s *Server) loadSelectedCosmetics(profile *profileResponse) error {
	var titleID, nicknameColorID, titleFrameID sql.NullString
	var badgeRaw []byte
	err := s.db.QueryRow(
		`SELECT title_id, nickname_color_id, title_frame_id, badge_ids_json
		 FROM user_chat_customization_selection WHERE user_id = ?`, profile.UserID,
	).Scan(&titleID, &nicknameColorID, &titleFrameID, &badgeRaw)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if titleID.Valid {
		item, err := s.loadChatItemPreview(titleID.String)
		if err == nil {
			profile.SelectedTitle = item
		}
	}
	if nicknameColorID.Valid {
		item, err := s.loadChatItemPreview(nicknameColorID.String)
		if err == nil {
			profile.NicknameStyle = item
		}
	}
	if titleFrameID.Valid {
		item, err := s.loadChatItemPreview(titleFrameID.String)
		if err == nil {
			profile.AvatarFrame = item
		}
	}
	var badgeIDs []string
	_ = json.Unmarshal(badgeRaw, &badgeIDs)
	for _, badgeID := range badgeIDs {
		item, err := s.loadChatItemPreview(badgeID)
		if err == nil {
			profile.SelectedBadges = append(profile.SelectedBadges, item)
		}
	}
	return nil
}

func (s *Server) loadChatItemPreview(itemID string) (map[string]any, error) {
	var previewRaw []byte
	if err := s.db.QueryRow(`SELECT preview_json FROM chat_customization_items WHERE id = ?`, itemID).Scan(&previewRaw); err != nil {
		return nil, err
	}
	out := map[string]any{}
	if err := json.Unmarshal(previewRaw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func avatarExtension(contentType string) (string, bool) {
	switch contentType {
	case "image/jpeg":
		return ".jpg", true
	case "image/png":
		return ".png", true
	case "image/webp":
		return ".webp", true
	case "image/gif":
		return ".gif", true
	default:
		return "", false
	}
}
