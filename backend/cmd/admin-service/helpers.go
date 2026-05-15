package main

import (
	"database/sql"
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)
func (s *Server) loadUserMatches(userID string, r *http.Request) ([]adminMatchItem, string, error) {
	limit, err := parseLimit(r, 20)
	if err != nil {
		return nil, "", err
	}
	offset, err := decodeCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		return nil, "", err
	}
	rows, err := s.db.Query(`
		SELECT match_id, mode, started_at, finished_at, user_id, user_nickname, opponent_rank, my_score, rating_delta, result,
		       opponent_user_id, opponent_nickname, opponent_score
		FROM user_match_history
		WHERE user_id = ?
		ORDER BY finished_at DESC, id DESC
		LIMIT ? OFFSET ?`, userID, limit+1, offset)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	items := []adminMatchItem{}
	for rows.Next() {
		var item adminMatchItem
		var result string
		if err := rows.Scan(&item.MatchID, &item.Mode, &item.StartedAt, &item.FinishedAt, &item.PlayerAID, &item.PlayerANickname, &item.PlayerARank, &item.PlayerAScore, &item.RatingDeltaA, &result, &item.PlayerBID, &item.PlayerBNickname, &item.PlayerBScore); err != nil {
			return nil, "", err
		}
		item.Result = result
		item.WinnerID = item.PlayerAID
		if result != "win" {
			item.WinnerID = ""
		}
		items = append(items, item)
	}
	nextCursor := ""
	if len(items) > limit {
		nextCursor = encodeCursor(offset + limit)
		items = items[:limit]
	}
	return items, nextCursor, nil
}

func rowToUserItem(row adminUserRow) userListItem {
	rating := 1500
	peak := 1500
	if row.Rating.Valid {
		rating = int(row.Rating.Int64)
	}
	if row.PeakRating.Valid {
		peak = int(row.PeakRating.Int64)
	}
	return userListItem{
		ID:                 fmt.Sprintf("u_%d", row.RawID),
		Nickname:           row.Nickname.String,
		Type:               row.Type,
		Role:               normalizeUserRole(row.Role),
		VerificationStatus: row.VerificationStatus,
		CreatedAt:          row.CreatedAt,
		UpdatedAt:          row.UpdatedAt,
		Rating:             rating,
		PeakRating:         peak,
		Rank:               rankFromRating(rating),
		Matches:            int(row.Matches.Int64),
		Wins:               int(row.Wins.Int64),
		Losses:             int(row.Losses.Int64),
		SelectedSoundID:    row.SelectedSoundID.String,
		SelectedSoundTitle: row.SelectedSoundTitle.String,
	}
}

func buildRatingPayload(userID, nickname string, rating, peak int, createdAt, updatedAt time.Time) map[string]any {
	bandName := rankBandFor(rating)
	nextRank := ""
	nextMin := 0
	progress := 100
	floor := 0
	for i, bandItem := range rankBands {
		if bandItem.Name != bandName {
			continue
		}
		floor = bandItem.Min
		if i == 0 {
			floor = 0
		}
		if i < len(rankBands)-1 {
			nextRank = rankBands[i+1].Name
			nextMin = rankBands[i+1].Min
			width := nextMin - bandItem.Min
			if width > 0 {
				progress = (rating - bandItem.Min) * 100 / width
				if progress < 0 {
					progress = 0
				}
				if progress > 100 {
					progress = 100
				}
			}
		}
		break
	}
	return map[string]any{
		"user_id": userID, "nickname": nickname, "rating": rating, "peak_rating": peak, "rank": bandName,
		"next_rank": nextRank, "rank_floor": floor, "next_rank_rating": nextMin, "progress_percent": progress,
		"created_at": createdAt, "updated_at": updatedAt,
	}
}

type rankBand struct {
	Name string
	Min  int
	Max  int
}

var rankBands = []rankBand{
	{"subhuman", -1 << 30, 999},
	{"subfive", 1000, 1299},
	{"ltn", 1300, 1599},
	{"mtn", 1600, 1899},
	{"htn", 1900, 2199},
	{"chadlite", 2200, 2499},
	{"chad", 2500, 2899},
	{"trueadam", 2900, 1 << 30},
}

func rankBandFor(rating int) string {
	for _, band := range rankBands {
		if rating >= band.Min && rating <= band.Max {
			return band.Name
		}
	}
	return rankBands[0].Name
}

func rankFromRating(rating int) string { return rankBandFor(rating) }

func parseLimit(r *http.Request, fallback int) (int, error) {
	limit := fallback
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > maxPageLimit {
			return 0, err
		}
		limit = n
	}
	return limit, nil
}

func encodeCursor(offset int) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(offset)))
}

func decodeCursor(raw string) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, nil
	}
	data, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(string(data))
}

func rawUserID(userID string) (int64, error) {
	if !strings.HasPrefix(userID, "u_") {
		return 0, fmt.Errorf("invalid_user_id")
	}
	return strconv.ParseInt(strings.TrimPrefix(userID, "u_"), 10, 64)
}

func normalizeUserRole(role string) string {
	switch strings.TrimSpace(strings.ToLower(role)) {
	case "user", "admin":
		return strings.TrimSpace(strings.ToLower(role))
	default:
		return ""
	}
}

func periodStart(period string) time.Time {
	now := time.Now().UTC()
	switch period {
	case "today":
		return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	case "week":
		return now.AddDate(0, 0, -7)
	case "season":
		return now.AddDate(0, 0, -90)
	default:
		return time.Time{}
	}
}

func percent(part, total int64) float64 {
	if total == 0 {
		return 0
	}
	return round2(float64(part) * 100 / float64(total))
}

func percentQuery(db *sql.DB, query string, total int64) float64 {
	if total == 0 {
		return 0
	}
	var part int64
	_ = db.QueryRow(query).Scan(&part)
	return percent(part, total)
}

func healthCheck(client *http.Client, rawURL string) (bool, int, string) {
	resp, err := client.Get(rawURL)
	if err != nil {
		return false, 0, err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return false, resp.StatusCode, fmt.Sprintf("unexpected_status_%d", resp.StatusCode)
	}
	return true, resp.StatusCode, ""
}

func handleLoadErr(w http.ResponseWriter, err error) {
	switch {
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "db_error")
	}
}

func appendWhere(where, cond string) string {
	if where == "" {
		return " WHERE " + cond
	}
	return " AND " + cond
}

func normalizeMatchResult(resultA, resultB string) string {
	if resultA == "draw" || resultB == "draw" {
		return "draw"
	}
	if resultA == "win" {
		return "win_a"
	}
	if resultB == "win" {
		return "win_b"
	}
	return "unknown"
}

func winnerID(item adminMatchItem, resultA, resultB string) string {
	if resultA == "win" {
		return item.PlayerAID
	}
	if resultB == "win" {
		return item.PlayerBID
	}
	return ""
}

func round2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}
