package main

import (
	"database/sql"
	"errors"
	"time"
)

func (s *Server) loadSummary(userID, nickname string, start, end time.Time) (*RatingProfile, statsSummary, error) {
	profile, err := s.ensureAndLoadRating(userID, nickname)
	if err != nil {
		return nil, statsSummary{}, err
	}
	summary := statsSummary{}

	query := `SELECT result, rating_delta, my_score, finished_at
		FROM user_match_history
		WHERE user_id = ?`
	args := []any{userID}
	if !start.IsZero() {
		query += ` AND finished_at >= ? AND finished_at < ?`
		args = append(args, start, end)
	}
	query += ` ORDER BY finished_at DESC, id DESC`
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, statsSummary{}, err
	}
	defer rows.Close()

	first := true
	scoreSum := 0.0
	gainSum, gainCount := 0, 0
	lossSum, lossCount := 0, 0
	for rows.Next() {
		var result string
		var delta int
		var score float64
		var finishedAt time.Time
		if err := rows.Scan(&result, &delta, &score, &finishedAt); err != nil {
			return nil, statsSummary{}, err
		}
		summary.Matches++
		scoreSum += score
		switch result {
		case "win":
			summary.Wins++
			if delta > 0 {
				gainSum += delta
				gainCount++
			}
		case "loss":
			summary.Losses++
			if delta < 0 {
				lossSum += -delta
				lossCount++
			}
		}
		if first {
			summary.Streak = streakSeed(result)
			first = false
		} else if advanceStreak(summary.Streak, result) {
			if summary.Streak > 0 {
				summary.Streak++
			} else if summary.Streak < 0 {
				summary.Streak--
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, statsSummary{}, err
	}

	if summary.Matches > 0 {
		summary.WinRate = round2(float64(summary.Wins) * 100 / float64(summary.Matches))
		summary.AverageScore = round2(scoreSum / float64(summary.Matches))
	}
	if gainCount > 0 {
		summary.AvgGain = round2(float64(gainSum) / float64(gainCount))
	}
	if lossCount > 0 {
		summary.AvgLoss = round2(float64(lossSum) / float64(lossCount))
	}
	return profile, summary, nil
}

func (s *Server) loadHistoryPoints(userID string, start, end time.Time, interval time.Duration) ([]historyPoint, error) {
	initialRating, err := s.ratingBefore(userID, start)
	if err != nil {
		return nil, err
	}
	matchRows, err := s.db.Query(
		`SELECT finished_at, my_score
		 FROM user_match_history
		 WHERE user_id = ? AND finished_at >= ? AND finished_at < ?
		 ORDER BY finished_at ASC, id ASC`,
		userID, start, end,
	)
	if err != nil {
		return nil, err
	}
	defer matchRows.Close()

	ratingRows, err := s.db.Query(
		`SELECT created_at, new_rating
		 FROM rating_history
		 WHERE user_id = ? AND created_at >= ? AND created_at < ?
		 ORDER BY created_at ASC, id ASC`,
		userID, start, end,
	)
	if err != nil {
		return nil, err
	}
	defer ratingRows.Close()

	buckets := map[time.Time]*historyAgg{}
	for ts := truncateTime(start, interval); ts.Before(end.Add(interval)); ts = ts.Add(interval) {
		buckets[ts] = &historyAgg{Rating: initialRating}
	}
	for matchRows.Next() {
		var finishedAt time.Time
		var score float64
		if err := matchRows.Scan(&finishedAt, &score); err != nil {
			return nil, err
		}
		key := truncateTime(finishedAt, interval)
		b := buckets[key]
		if b == nil {
			b = &historyAgg{Rating: initialRating}
			buckets[key] = b
		}
		b.Matches++
		b.ScoreSum += score
	}
	if err := matchRows.Err(); err != nil {
		return nil, err
	}

	for ratingRows.Next() {
		var createdAt time.Time
		var newRating int
		if err := ratingRows.Scan(&createdAt, &newRating); err != nil {
			return nil, err
		}
		key := truncateTime(createdAt, interval)
		b := buckets[key]
		if b == nil {
			b = &historyAgg{}
			buckets[key] = b
		}
		b.Rating = newRating
	}
	if err := ratingRows.Err(); err != nil {
		return nil, err
	}

	points := make([]historyPoint, 0, len(buckets))
	lastRating := initialRating
	for ts := truncateTime(start, interval); ts.Before(end); ts = ts.Add(interval) {
		b := buckets[ts]
		if b == nil {
			b = &historyAgg{Rating: lastRating}
		}
		if b.Rating == 0 {
			b.Rating = lastRating
		}
		lastRating = b.Rating
		avgScore := 0.0
		if b.Matches > 0 {
			avgScore = round2(b.ScoreSum / float64(b.Matches))
		}
		points = append(points, historyPoint{
			TS:           ts,
			Rating:       b.Rating,
			AverageScore: avgScore,
			Matches:      b.Matches,
		})
	}
	return points, nil
}

func (s *Server) ratingBefore(userID string, start time.Time) (int, error) {
	var rating int
	err := s.db.QueryRow(
		`SELECT new_rating
		 FROM rating_history
		 WHERE user_id = ? AND created_at < ?
		 ORDER BY created_at DESC, id DESC
		 LIMIT 1`,
		userID, start,
	).Scan(&rating)
	if err == nil {
		return rating, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	profile, err := s.ensureAndLoadRating(userID, "")
	if err != nil {
		return 0, err
	}
	return profile.Rating, nil
}

func (s *Server) recordDuel(req duelRecordRequest) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var exists int
	if err := tx.QueryRow(`SELECT 1 FROM user_match_history WHERE match_id = ? LIMIT 1`, req.MatchID).Scan(&exists); err == nil {
		return errMatchAlreadyRecorded
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	profileA, err := s.ensureAndLoadRatingTx(tx, req.PlayerAID, req.PlayerANickname)
	if err != nil {
		return err
	}
	profileB, err := s.ensureAndLoadRatingTx(tx, req.PlayerBID, req.PlayerBNickname)
	if err != nil {
		return err
	}

	scoreA, scoreB := 0.5, 0.5
	resultA, resultB := "draw", "draw"
	if req.WinnerID == req.PlayerAID {
		scoreA, scoreB = 1, 0
		resultA, resultB = "win", "loss"
	} else if req.WinnerID == req.PlayerBID {
		scoreA, scoreB = 0, 1
		resultA, resultB = "loss", "win"
	}

	deltaA, deltaB, newA, newB := applyElo(profileA.Rating, profileB.Rating, scoreA, scoreB)
	peakA := maxInt(profileA.PeakRating, newA)
	peakB := maxInt(profileB.PeakRating, newB)

	if _, err := tx.Exec(
		`UPDATE user_ratings SET rating = ?, peak_rating = ?, updated_at = ? WHERE user_id = ?`,
		newA, peakA, req.FinishedAt, req.PlayerAID,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(
		`UPDATE user_ratings SET rating = ?, peak_rating = ?, updated_at = ? WHERE user_id = ?`,
		newB, peakB, req.FinishedAt, req.PlayerBID,
	); err != nil {
		return err
	}

	if _, err := tx.Exec(
		`INSERT INTO rating_history (user_id, delta, old_rating, new_rating, reason, source_id, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)`,
		req.PlayerAID, deltaA, profileA.Rating, newA, duelReason(req.Reason), req.MatchID, req.FinishedAt,
		req.PlayerBID, deltaB, profileB.Rating, newB, duelReason(req.Reason), req.MatchID, req.FinishedAt,
	); err != nil {
		return err
	}

	opponentRankForA := rankFromRating(newB).Name
	opponentRankForB := rankFromRating(newA).Name
	if _, err := tx.Exec(
		`INSERT INTO user_match_history (
			match_id, mode, user_id, user_nickname, opponent_user_id, opponent_nickname, opponent_rank,
			result, rating_delta, my_score, opponent_score, started_at, finished_at, created_at
		) VALUES
			(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
			(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		req.MatchID, safeMode(req.Mode), req.PlayerAID, req.PlayerANickname, req.PlayerBID, req.PlayerBNickname, opponentRankForA,
		resultA, deltaA, req.PlayerAScore, req.PlayerBScore, req.StartedAt, req.FinishedAt, req.FinishedAt,
		req.MatchID, safeMode(req.Mode), req.PlayerBID, req.PlayerBNickname, req.PlayerAID, req.PlayerANickname, opponentRankForB,
		resultB, deltaB, req.PlayerBScore, req.PlayerAScore, req.StartedAt, req.FinishedAt, req.FinishedAt,
	); err != nil {
		return err
	}

	return tx.Commit()
}
