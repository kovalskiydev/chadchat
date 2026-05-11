package main

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
)

func main() {
	authURL := envOr("AUTH_SERVICE_URL", "http://localhost:8081")
	verificationURL := envOr("VERIFICATION_SERVICE_URL", "http://localhost:8082")
	testLabURL := envOr("TEST_LAB_SERVICE_URL", "http://localhost:8083")
	liveChatURL := envOr("LIVE_CHAT_SERVICE_URL", "http://localhost:8084")
	duelURL := envOr("DUEL_SERVICE_URL", "http://localhost:8085")

	authProxy := mustProxy(authURL)
	verificationProxy := mustProxy(verificationURL)
	testLabProxy := mustProxy(testLabURL)
	liveChatProxy := mustProxy(liveChatURL)
	duelProxy := mustProxy(duelURL)

	mux := http.NewServeMux()
	mux.Handle("/auth/", authProxy)
	mux.Handle("/me", authProxy)
	mux.Handle("/verification/start", verificationProxy)
	mux.Handle("/verification/submit", verificationProxy)
	mux.Handle("/test-lab/", testLabProxy)
	mux.Handle("/live-chat/", liveChatProxy)
	mux.Handle("/duel/", duelProxy)

	addr := ":" + envOr("PORT", "8080")
	log.Printf("api-gateway on %s", addr)
	log.Fatal(http.ListenAndServe(addr, withCORS(mux)))
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
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
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
