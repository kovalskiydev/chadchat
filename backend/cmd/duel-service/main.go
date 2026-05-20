package main

import (
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"backend/internal/httputil"
	"backend/internal/rateutil"
)

const (
	phaseAwaitingMedia = "awaiting_media"
	phasePreStart      = "pre_start"
	phaseScoring       = "scoring"
	phaseOvertime      = "overtime"
	phaseResult        = "result"
	phasePostChat      = "post_chat"
	phaseFinished      = "finished"

	preStartDuration        = 10 * time.Second
	scoringDuration         = 20 * time.Second
	overtimeDuration        = 10 * time.Second
	postChatDuration        = 15 * time.Second
	mediaReadyGraceDuration = 5 * time.Second
	tieThreshold            = 0.15
	scoreRateLimitPerMinute = 210
	botInjectDelay          = 10 * time.Second

	botPrefix = "bot_"

	// matchEventBufCap — сколько последних событий хранить для replay при переподключении.
	matchEventBufCap = 50
	// matchCleanupDelay — через сколько секунд удалять завершённый матч из памяти.
	matchCleanupDelay = 90 * time.Second
)

// sseEvent — элемент SSE-канала. Seq > 0 означает что клиент получит «id: N» для Last-Event-ID.
type sseEvent struct {
	Seq     int64
	Payload []byte
}

// MatchEvent хранится в кольцевом буфере матча для replay при переподключении.
type MatchEvent struct {
	Seq     int64
	Payload []byte
}

type Server struct {
	authServiceURL          string
	mlServiceURL            string
	customizationServiceURL string
	customizationSecret     string
	ratingServiceURL        string
	ratingInternalSecret    string
	defaultResultSoundURL   string
	stunURL                 string
	turnURLs                []string
	turnUsername            string
	turnCredential          string
	turnSharedSecret        string
	turnCredentialTTL       time.Duration
	store                   *Store
	limiter                 *rateutil.Limiter
	botEnabled              bool
	botSkillMin             float64
	botSkillMax             float64
	botScoreInterval        time.Duration
	botVideoURLs            []string
}

type Store struct {
	mu            sync.Mutex
	queue         []authUser
	matches       map[string]*Match
	userToMatchID map[string]string
	queueJoinedAt map[string]time.Time // userID -> when they joined queue (for bot delay)
}

type Match struct {
	ID               string                     `json:"id"`
	PlayerA          string                     `json:"player_a"`
	PlayerB          string                     `json:"player_b"`
	Phase            string                     `json:"phase"`
	StartedAt        time.Time                  `json:"started_at"`
	PhaseEndsAt      time.Time                  `json:"phase_ends_at"`
	Result           *MatchResult               `json:"result,omitempty"`
	Players          map[string]*PlayerProgress `json:"players"`
	ResultSounds     map[string]ResultSound     `json:"-"`
	MediaReady       map[string]bool            `json:"-"`
	Subscribers      map[string]chan sseEvent   `json:"-"`
	subscriberUserID map[string]string          `json:"-"` // subID -> userID
	Connections      map[string]int             `json:"-"`
	Recorded         bool                       `json:"-"`
	Cancelled        bool                       `json:"-"`
	BotVideoURL      string                     `json:"-"`
	BotScore         *BotScoreState             `json:"-"`
	eventBuf         []MatchEvent               `json:"-"` // кольцевой буфер для SSE replay
	nextSeq          int64                      `json:"-"` // монотонный счётчик событий
}

type PlayerProgress struct {
	UserID      string    `json:"user_id"`
	Nickname    string    `json:"nickname"`
	LastScore   float64   `json:"last_score"`
	RunningAvg  float64   `json:"running_avg"`
	FinalAvg    float64   `json:"final_avg"`
	Samples     int       `json:"samples"`
	LastUpdated time.Time `json:"last_updated"`
}

type BotScoreState struct {
	Base       float64
	Drift      float64
	Volatility float64
	Ticks      int
}

type MatchResult struct {
	WinnerID string  `json:"winner_id,omitempty"`
	LoserID  string  `json:"loser_id,omitempty"`
	Reason   string  `json:"reason"`
	ScoreA   float64 `json:"score_a"`
	ScoreB   float64 `json:"score_b"`
}

type ResultSound struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	AudioURL string `json:"audio_url"`
}

type authUser struct {
	ID       string
	Nickname string
}

type scoreFrameRequest struct {
	ImageBase64 string `json:"image_base64"`
}

type signalRequest struct {
	Type      string `json:"type"`
	SDP       string `json:"sdp,omitempty"`
	Candidate string `json:"candidate,omitempty"`
	SDPMid    string `json:"sdp_mid,omitempty"`
	SDPMLine  int    `json:"sdp_mline_index,omitempty"`
}

type rtcConfigResponse struct {
	ICEServers []map[string]any `json:"ice_servers"`
}

type mlPredictResponse struct {
	Score float64 `json:"score"`
}

type customizationSoundResponse struct {
	Sound ResultSound `json:"sound"`
}

type duelRecordRequest struct {
	MatchID         string    `json:"match_id"`
	Mode            string    `json:"mode"`
	StartedAt       time.Time `json:"started_at"`
	FinishedAt      time.Time `json:"finished_at"`
	PlayerAID       string    `json:"player_a_id"`
	PlayerANickname string    `json:"player_a_nickname"`
	PlayerAScore    float64   `json:"player_a_score"`
	PlayerBID       string    `json:"player_b_id"`
	PlayerBNickname string    `json:"player_b_nickname"`
	PlayerBScore    float64   `json:"player_b_score"`
	WinnerID        string    `json:"winner_id,omitempty"`
	Reason          string    `json:"reason"`
}

func main() {
	s := &Server{
		authServiceURL:          httputil.EnvOr("AUTH_SERVICE_URL", "http://localhost:8081"),
		mlServiceURL:            httputil.EnvOr("ML_SERVICE_URL", "http://localhost:8090"),
		customizationServiceURL: httputil.EnvOr("CUSTOMIZATION_SERVICE_URL", "http://localhost:8087"),
		customizationSecret:     httputil.EnvOr("CUSTOMIZATION_INTERNAL_SECRET", "dev-customization-secret-change-me"),
		ratingServiceURL:        httputil.EnvOr("RATING_SERVICE_URL", "http://localhost:8086"),
		ratingInternalSecret:    httputil.EnvOr("RATING_INTERNAL_SECRET", "dev-rating-secret-change-me"),
		defaultResultSoundURL:   httputil.EnvOr("DEFAULT_RESULT_SOUND_URL", "https://cdn.chadchat.example/sounds/default_win.mp3"),
		stunURL:                 strings.TrimSpace(httputil.EnvOr("WEBRTC_STUN_URL", "stun:stun.l.google.com:19302")),
		turnURLs:                splitCSV(httputil.EnvOr("WEBRTC_TURN_URLS", "")),
		turnUsername:            strings.TrimSpace(httputil.EnvOr("WEBRTC_TURN_USERNAME", "")),
		turnCredential:          strings.TrimSpace(httputil.EnvOr("WEBRTC_TURN_CREDENTIAL", "")),
		turnSharedSecret:        strings.TrimSpace(httputil.EnvOr("WEBRTC_TURN_SHARED_SECRET", "")),
		turnCredentialTTL:       turnCredentialTTL(),
		store: &Store{
			queue:         []authUser{},
			matches:       map[string]*Match{},
			userToMatchID: map[string]string{},
			queueJoinedAt: map[string]time.Time{},
		},
		limiter:          rateutil.NewLimiter(),
		botEnabled:       httputil.EnvOr("DUEL_BOT_ENABLED", "") == "true",
		botSkillMin:      parseFloatEnv("DUEL_BOT_SKILL_MIN", 2.5),
		botSkillMax:      parseFloatEnv("DUEL_BOT_SKILL_MAX", 4.5),
		botScoreInterval: parseDurationEnv("DUEL_BOT_SCORE_INTERVAL_MS", 1500),
		botVideoURLs:     splitCSV(httputil.EnvOr("DUEL_BOT_VIDEO_URLS", "")),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("POST /duel/queue/join", s.withAuth(s.handleJoinQueue))
	mux.HandleFunc("POST /duel/queue/leave", s.withAuth(s.handleLeaveQueue))
	mux.HandleFunc("GET /duel/match/current", s.withAuth(s.handleCurrentMatch))
	mux.HandleFunc("GET /duel/match/{matchID}", s.withAuth(s.handleGetMatch))
	mux.HandleFunc("GET /duel/match/{matchID}/stream", s.withAuth(s.handleStream))
	mux.HandleFunc("GET /duel/rtc-config", s.withAuth(s.handleRTCConfig))
	mux.HandleFunc("POST /duel/match/{matchID}/media-ready", s.withAuth(s.handleMediaReady))
	mux.HandleFunc("POST /duel/match/{matchID}/signal", s.withAuth(s.handleSignal))
	mux.HandleFunc("POST /duel/match/{matchID}/score-frame", s.withRateLimit(scoreRateLimitPerMinute, time.Minute, s.withAuth(s.handleScoreFrame)))

	go s.runBotInjector()

	addr := ":" + httputil.EnvOr("PORT", "8085")
	log.Printf("duel-service on %s", addr)
	log.Fatal(http.ListenAndServe(addr, withJSON(mux)))
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"status": "ok",
	})
}

func (s *Server) withAuth(next func(http.ResponseWriter, *http.Request, authUser)) http.HandlerFunc {
	return httputil.WithAuth(s.authServiceURL, func(w http.ResponseWriter, r *http.Request, u httputil.User) {
		next(w, r, authUser{ID: u.ID, Nickname: u.Nickname})
	})
}

func (s *Server) withRateLimit(limit int, window time.Duration, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := r.Method + ":" + r.URL.Path + ":" + rateutil.ClientKey(r)
		if !s.limiter.Allow(key, limit, window) {
			httputil.WriteErr(w, http.StatusTooManyRequests, "rate_limited")
			return
		}
		next(w, r)
	}
}

func (s *Server) defaultResultSound() ResultSound {
	return ResultSound{
		ID:       "default_win",
		Title:    "Default Win",
		AudioURL: s.defaultResultSoundURL,
	}
}

func withJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/stream") {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
		}
		next.ServeHTTP(w, r)
	})
}

func parseFloatEnv(key string, fallback float64) float64 {
	if raw := strings.TrimSpace(httputil.EnvOr(key, "")); raw != "" {
		if v, err := strconv.ParseFloat(raw, 64); err == nil {
			return v
		}
	}
	return fallback
}

func parseDurationEnv(key string, fallbackMs int) time.Duration {
	if raw := strings.TrimSpace(httputil.EnvOr(key, "")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			return time.Duration(v) * time.Millisecond
		}
	}
	return time.Duration(fallbackMs) * time.Millisecond
}
