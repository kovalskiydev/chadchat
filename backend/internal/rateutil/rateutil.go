package rateutil

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type Limiter struct {
	mu      sync.Mutex
	entries map[string]*entry
}

type entry struct {
	count      int
	windowEnds time.Time
}

func NewLimiter() *Limiter {
	return &Limiter{entries: make(map[string]*entry)}
}

func (l *Limiter) Allow(key string, limit int, window time.Duration) bool {
	now := time.Now().UTC()

	l.mu.Lock()
	defer l.mu.Unlock()

	e, ok := l.entries[key]
	if !ok || now.After(e.windowEnds) {
		l.entries[key] = &entry{
			count:      1,
			windowEnds: now.Add(window),
		}
		return true
	}

	if e.count >= limit {
		return false
	}

	e.count++
	return true
}

func ClientKey(r *http.Request) string {
	if raw := r.Header.Get("X-Forwarded-For"); raw != "" {
		parts := strings.Split(raw, ",")
		if len(parts) > 0 {
			if ip := strings.TrimSpace(parts[0]); ip != "" {
				return ip
			}
		}
	}

	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}

	return r.RemoteAddr
}
