package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"
)

func main() {
	authURL := envOr("AUTH_SERVICE_URL", "http://localhost:8081")
	verificationURL := envOr("VERIFICATION_SERVICE_URL", "http://localhost:8082")
	testLabURL := envOr("TEST_LAB_SERVICE_URL", "http://localhost:8083")
	liveChatURL := envOr("LIVE_CHAT_SERVICE_URL", "http://localhost:8084")
	duelURL := envOr("DUEL_SERVICE_URL", "http://localhost:8085")
	ratingURL := envOr("RATING_SERVICE_URL", "http://localhost:8086")
	customizationURL := envOr("CUSTOMIZATION_SERVICE_URL", "http://localhost:8087")
	adminURL := envOr("ADMIN_SERVICE_URL", "http://localhost:8088")
	profileURL := envOr("PROFILE_SERVICE_URL", "http://localhost:8089")

	authProxy := mustProxy(authURL)
	verificationProxy := mustProxy(verificationURL)
	testLabProxy := mustProxy(testLabURL)
	liveChatProxy := mustProxy(liveChatURL)
	duelProxy := mustProxy(duelURL)
	ratingProxy := mustProxy(ratingURL)
	customizationProxy := mustProxy(customizationURL)
	adminProxy := mustProxy(adminURL)
	profileProxy := mustProxy(profileURL)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", handleHealth(map[string]string{
		"auth":          authURL,
		"verification":  verificationURL,
		"test_lab":      testLabURL,
		"live_chat":     liveChatURL,
		"duel":          duelURL,
		"rating":        ratingURL,
		"customization": customizationURL,
		"admin":         adminURL,
		"profile":       profileURL,
	}))
	mux.Handle("/auth/", authProxy)
	mux.Handle("/me", authProxy)
	mux.Handle("/verification/start", verificationProxy)
	mux.Handle("/verification/submit", verificationProxy)
	mux.Handle("/test-lab/", testLabProxy)
	mux.Handle("/live-chat/", liveChatProxy)
	mux.Handle("/duel/", duelProxy)
	mux.Handle("/rating/", ratingProxy)
	mux.Handle("/stats/", ratingProxy)
	mux.Handle("/matches/", ratingProxy)
	mux.Handle("/leaderboard", ratingProxy)
	mux.Handle("/result-sounds", customizationProxy)
	mux.Handle("/result-sounds/", customizationProxy)
	mux.Handle("/chat-customization/", customizationProxy)
	mux.Handle("/profiles/", profileProxy)
	mux.Handle("/admin/dashboard/", adminProxy)
	mux.Handle("/admin/dashboard", adminProxy)
	mux.Handle("/admin/users/", adminProxy)
	mux.Handle("/admin/users", adminProxy)
	mux.Handle("/admin/ratings/", adminProxy)
	mux.Handle("/admin/ratings", adminProxy)
	mux.Handle("/admin/matches/", adminProxy)
	mux.Handle("/admin/matches", adminProxy)
	mux.Handle("/admin/verification/", adminProxy)
	mux.Handle("/admin/verification", adminProxy)
	mux.Handle("/admin/test-lab/", adminProxy)
	mux.Handle("/admin/test-lab", adminProxy)
	mux.Handle("/admin/chat/", adminProxy)
	mux.Handle("/admin/chat", adminProxy)
	mux.Handle("/admin/system/", adminProxy)
	mux.Handle("/admin/system", adminProxy)
	mux.HandleFunc("/admin/result-sounds", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			adminProxy.ServeHTTP(w, r)
			return
		}
		customizationProxy.ServeHTTP(w, r)
	})
	mux.HandleFunc("/admin/result-sounds/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			adminProxy.ServeHTTP(w, r)
			return
		}
		customizationProxy.ServeHTTP(w, r)
	})

	addr := ":" + envOr("PORT", "8080")
	log.Printf("api-gateway on %s", addr)
	log.Fatal(http.ListenAndServe(addr, withCORS(mux)))
}

type healthComponent struct {
	OK         bool   `json:"ok"`
	StatusCode int    `json:"status_code,omitempty"`
	Error      string `json:"error,omitempty"`
}

func handleHealth(services map[string]string) http.HandlerFunc {
	client := &http.Client{Timeout: 2 * time.Second}
	return func(w http.ResponseWriter, _ *http.Request) {
		checks := make(map[string]healthComponent, len(services)+1)
		allOK := true
		for name, baseURL := range services {
			ref := strings.TrimRight(baseURL, "/") + "/health"
			ok, statusCode, errText := healthCheck(client, ref)
			checks[name] = healthComponent{
				OK:         ok,
				StatusCode: statusCode,
				Error:      errText,
			}
			if !ok {
				allOK = false
			}
		}

		mlURL := envOr("ML_SERVICE_URL", "http://localhost:8090")
		ok, statusCode, errText := healthCheck(client, strings.TrimRight(mlURL, "/")+"/health")
		checks["ml"] = healthComponent{
			OK:         ok,
			StatusCode: statusCode,
			Error:      errText,
		}
		if !ok {
			allOK = false
		}

		statusCodeOut := http.StatusOK
		statusText := "ok"
		if !allOK {
			statusCodeOut = http.StatusServiceUnavailable
			statusText = "degraded"
		}

		writeJSON(w, statusCodeOut, map[string]any{
			"ok":       allOK,
			"status":   statusText,
			"services": checks,
		})
	}
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

func mustProxy(raw string) *httputil.ReverseProxy {
	u, err := url.Parse(raw)
	if err != nil {
		panic(err)
	}
	return httputil.NewSingleHostReverseProxy(u)
}

func withCORS(next http.Handler) http.Handler {
	allowed := allowedOrigins()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if originAllowed(origin, allowed) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS, DELETE")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Secret")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func allowedOrigins() map[string]struct{} {
	raw := envOr("CORS_ALLOWED_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173")
	allowed := make(map[string]struct{})
	for _, part := range strings.Split(raw, ",") {
		origin := strings.TrimSpace(part)
		if origin == "" {
			continue
		}
		allowed[origin] = struct{}{}
	}
	return allowed
}

func originAllowed(origin string, allowed map[string]struct{}) bool {
	if origin == "" {
		return false
	}
	if _, ok := allowed["*"]; ok {
		return true
	}
	_, ok := allowed[origin]
	return ok
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
