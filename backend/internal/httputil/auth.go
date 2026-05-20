package httputil

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"
)

// HTTPClient is used for all service-to-service calls.
var HTTPClient = &http.Client{Timeout: 5 * time.Second}

var defaultTokenCache = newTokenCache(60 * time.Second)

type tokenCache struct {
	ttl     time.Duration
	mu      sync.RWMutex
	entries map[string]tokenEntry
}

type tokenEntry struct {
	user      User
	expiresAt time.Time
}

func newTokenCache(ttl time.Duration) *tokenCache {
	c := &tokenCache{ttl: ttl, entries: make(map[string]tokenEntry)}
	go c.runCleanup()
	return c
}

func (c *tokenCache) get(token string) (User, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	e, ok := c.entries[token]
	if !ok || time.Now().After(e.expiresAt) {
		return User{}, false
	}
	return e.user, true
}

func (c *tokenCache) set(token string, user User) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[token] = tokenEntry{user: user, expiresAt: time.Now().Add(c.ttl)}
}

func (c *tokenCache) runCleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		now := time.Now()
		c.mu.Lock()
		for k, e := range c.entries {
			if now.After(e.expiresAt) {
				delete(c.entries, k)
			}
		}
		c.mu.Unlock()
	}
}

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
	if u, ok := defaultTokenCache.get(authHeader); ok {
		return u, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, authServiceURL+"/me", nil)
	if err != nil {
		return User{}, err
	}
	req.Header.Set("Authorization", authHeader)
	resp, err := HTTPClient.Do(req)
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
	user := User{
		ID:        me.User.ID,
		Nickname:  me.User.Nickname,
		Type:      me.User.Type,
		Role:      me.User.Role,
		CreatedAt: me.User.CreatedAt,
	}
	defaultTokenCache.set(authHeader, user)
	return user, nil
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
