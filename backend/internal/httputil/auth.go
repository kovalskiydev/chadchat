package httputil

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

type User struct {
	ID        string
	Nickname  string
	Type      string
	Role      string
	CreatedAt time.Time
}

type meResponse struct {
	User struct {
		ID        string    `json:"id"`
		Nickname  string    `json:"nickname"`
		Type      string    `json:"type"`
		Role      string    `json:"role"`
		CreatedAt time.Time `json:"created_at"`
	} `json:"user"`
}

func ResolveUser(ctx context.Context, authServiceURL, authHeader string) (User, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, authServiceURL+"/me", nil)
	if err != nil {
		return User{}, err
	}
	req.Header.Set("Authorization", authHeader)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return User{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return User{}, errors.New("unauthorized")
	}
	var me meResponse
	if err := json.NewDecoder(resp.Body).Decode(&me); err != nil {
		return User{}, err
	}
	if me.User.ID == "" {
		return User{}, errors.New("empty_user")
	}
	return User{
		ID:        me.User.ID,
		Nickname:  me.User.Nickname,
		Type:      me.User.Type,
		Role:      me.User.Role,
		CreatedAt: me.User.CreatedAt,
	}, nil
}

func WithAuth(authServiceURL string, next func(http.ResponseWriter, *http.Request, User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			WriteErr(w, http.StatusUnauthorized, "missing_bearer_token")
			return
		}
		user, err := ResolveUser(r.Context(), authServiceURL, authHeader)
		if err != nil {
			WriteErr(w, http.StatusUnauthorized, "invalid_access_token")
			return
		}
		next(w, r, user)
	}
}
