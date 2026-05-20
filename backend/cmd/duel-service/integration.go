package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"backend/internal/httputil"
)

// integrationClient используется для всех inter-service вызовов из duel-service.
var integrationClient = &http.Client{Timeout: 5 * time.Second}

func (s *Server) predictScore(imageBase64 string) (float64, error) {
	payload, _ := json.Marshal(map[string]string{"image_base64": imageBase64})
	req, err := http.NewRequest(http.MethodPost, s.mlServiceURL+"/predict", bytes.NewReader(payload))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := integrationClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return 0, fmt.Errorf("predict failed: %s", string(body))
	}
	var out mlPredictResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return 0, err
	}
	return out.Score, nil
}

func (s *Server) recordFinishedMatch(req duelRecordRequest) {
	// skip recording bot matches
	if isBot(req.PlayerAID) || isBot(req.PlayerBID) {
		return
	}
	payload, _ := json.Marshal(req)
	httpReq, err := http.NewRequest(
		http.MethodPost,
		strings.TrimRight(s.ratingServiceURL, "/")+"/rating/internal/record-duel",
		bytes.NewReader(payload),
	)
	if err != nil {
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-Rating-Internal-Secret", s.ratingInternalSecret)
	resp, err := integrationClient.Do(httpReq)
	if err != nil {
		return
	}
	defer resp.Body.Close()
}

func (s *Server) hydrateMatchResultSounds(matchID string) {
	s.store.mu.Lock()
	m := s.store.matches[matchID]
	if m == nil {
		s.store.mu.Unlock()
		return
	}
	playerA := m.PlayerA
	playerB := m.PlayerB
	s.store.mu.Unlock()

	soundA, errA := s.fetchResultSound(playerA)
	soundB, errB := s.fetchResultSound(playerB)

	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	m = s.store.matches[matchID]
	if m == nil {
		return
	}
	updated := false
	if errA == nil {
		m.ResultSounds[playerA] = soundA
		updated = true
	}
	if errB == nil {
		m.ResultSounds[playerB] = soundB
		updated = true
	}
	if updated {
		s.broadcastLocked(m, map[string]any{
			"type":  "result_sounds_updated",
			"match": s.snapshotMatch(m),
		})
	}
}

func (s *Server) fetchResultSound(userID string) (ResultSound, error) {
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(s.customizationServiceURL, "/")+"/internal/users/"+userID+"/result-sound", nil)
	if err != nil {
		return ResultSound{}, err
	}
	req.Header.Set("X-Customization-Internal-Secret", s.customizationSecret)
	resp, err := integrationClient.Do(req)
	if err != nil {
		return ResultSound{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return ResultSound{}, fmt.Errorf("customization failed: %s", string(body))
	}
	var out customizationSoundResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return ResultSound{}, err
	}
	if out.Sound.ID == "" || out.Sound.AudioURL == "" {
		return ResultSound{}, errors.New("empty_sound")
	}
	return out.Sound, nil
}

func (s *Server) buildICEServers() []map[string]any {
	servers := []map[string]any{}
	if s.stunURL != "" {
		servers = append(servers, map[string]any{"urls": []string{s.stunURL}})
	}
	if len(s.turnURLs) > 0 {
		if username, credential, ok := s.generateTurnCredentials(); ok {
			servers = append(servers, map[string]any{
				"urls":       s.turnURLs,
				"username":   username,
				"credential": credential,
			})
		} else if s.turnUsername != "" && s.turnCredential != "" {
			servers = append(servers, map[string]any{
				"urls":       s.turnURLs,
				"username":   s.turnUsername,
				"credential": s.turnCredential,
			})
		}
	}
	return servers
}

func (s *Server) generateTurnCredentials() (string, string, bool) {
	if s.turnSharedSecret == "" || len(s.turnURLs) == 0 {
		return "", "", false
	}
	expiry := time.Now().UTC().Add(s.turnCredentialTTL).Unix()
	username := fmt.Sprintf("%d", expiry)
	mac := hmac.New(sha1.New, []byte(s.turnSharedSecret))
	_, _ = mac.Write([]byte(username))
	credential := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return username, credential, true
}

func splitCSV(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func turnCredentialTTL() time.Duration {
	ttlSec := 600
	if raw := strings.TrimSpace(httputil.EnvOr("WEBRTC_TURN_TTL_SEC", "")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			return time.Duration(n) * time.Second
		}
	}
	return time.Duration(ttlSec) * time.Second
}
