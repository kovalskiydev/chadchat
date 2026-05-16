import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import {
  ChevronLeft,
  ChevronRight,
  X,
  MessageSquare,
  Send,
  ShoppingBag,
  Signal,
  Trophy,
  UserRoundCog,
  CircleHelp,
  LogOut,
  User,
  Camera,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";

import Crosshair from "@/components/Crosshair";
import GradientText from "@/components/GradientText";
import { GlobalSpotlight, ParticleCard } from "@/components/MagicBento";
import PixelBlast from "@/components/PixelBlast";
import Shuffle from "@/components/Shuffle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AUTH_TOKENS_CHANGED_EVENT,
  authAnonymous,
  authLogin,
  authLogout,
  authRefresh,
  authRegister,
  authUpgrade,
  getMe,
  loadTokens,
  saveTokens,
  type AuthTokens,
  type AuthUser,
  type VerificationStartResponse,
  verificationStart,
  verificationSubmit,
} from "@/lib/auth";
import {
  createTestLabRoom,
  getTestLabSession,
  getTestLabRoom,
  scanTestLabSession,
  startTestLabSession,
  type TestLabRoom,
} from "@/lib/testLab";
import {
  deleteLiveChatMessage,
  getLiveChatHistory,
  sendLiveChatMessage,
  streamLiveChat,
  type ChatStyleSnapshot,
  type LiveChatMessage,
} from "@/lib/liveChat";
import {
  clearChatCustomizationSlot,
  getChatCustomizationCatalog,
  getMyChatCustomization,
  selectChatCustomizationItem,
  type ChatCustomizationCatalog,
  type ChatCustomizationItem,
  type ChatCustomizationSelection,
  type ChatCustomizationSlot,
} from "@/lib/chatCustomization";
import {
  duelCurrentMatch,
  duelGetMatch,
  duelMediaReady,
  duelQueueJoin,
  duelQueueLeave,
  duelRtcConfig,
  duelScoreFrame,
  duelSignal,
  duelStream,
} from "@/lib/duel";
import { getApiHealth } from "@/lib/health";
import {
  getFaceLandmarker,
  preloadFaceLandmarker,
  retryFaceLandmarker,
  type ChadFaceLandmarker,
} from "@/lib/faceLandmarker";
import {
  getLeaderboard,
  getMyMatches,
  getQueueInfo,
  getRecentForm,
  getMyRating,
  getStatsPeriod,
  getStatsSummary,
  type LeaderboardEntry,
  type MatchHistoryEntry,
  type RatingProfile,
  type QueueInfo,
  type StatsPeriod,
  type StatsSummary,
} from "@/lib/rating";
import {
  createAvatarUpload,
  deleteProfileComment,
  getMyProfile,
  getProfileComments,
  getPublicProfile,
  postProfileComment,
  updateMyProfile,
  voteProfileComment,
  type Profile,
  type ProfileComment,
} from "@/lib/profile";
import {
  getResultSounds,
  selectResultSound,
  type ResultSoundOption,
} from "@/lib/resultSounds";
import { Avatar, PositionAvatar } from "@/components/ui/Avatar";
import { AdminBadge } from "@/components/ui/AdminBadge";
import { Panel } from "@/components/ui/Panel";
import { MagicButton } from "@/components/ui/MagicButton";
import { StatsPanel } from "@/components/ui/StatsPanel";
import { ChatMessageItem } from "@/components/ui/ChatMessageItem";
import {
  formatDateShort,
  formatRankLabel,
  buildStatsSnapshot,
  buildPeriodStats,
  mapPeriodStats,
  getAvatarClass,
  getAvatarInitials,
  isAdminRole,
  getNickColorClass,
  getChatTextClass,
  getInlineColorStyle,
  getChatStyleTextClass,
  getChatStyleFrameClass,
  getSelectedChatStyle,
  isAnimatedTitle,
  getTitleBorderColorClass,
  getTitleBorderShapeClass,
  getGameFrameClass,
  normalizeDuelResultSound,
  getRankClass,
  getTopClass,
  getTopAccentClass,
  getPositionClass,
  getTopGradientColors,
  getRoomID,
  formatScoreOutOfTen,
  formatProfileScore,
  profileTitleStyle,
} from "@/lib/utils-app";
import {
  statsByPeriod,
  type StatsPeriodKey,
  type StatsSnapshot,
  type UiPeriodStats,
  type ChatMessage,
  type ChatCustomization,
  type GameCustomization,
  type DuelResultSound,
  defaultChatCustomization,
  defaultGameCustomization,
  initialChatMessages,
  leaderboardPageSize,
} from "@/types/app";
import { magicBlockClass, magicGlow, duelQueueTracks } from "@/lib/constants";

export function DuelModal({
  accessToken,
  myUserId,
  resultSoundEnabled,
  resultSoundVolume,
  onFinished,
  onClose,
}: {
  accessToken: string | null;
  myUserId: string | null;
  resultSoundEnabled: boolean;
  resultSoundVolume: number;
  onFinished?: () => Promise<MatchHistoryEntry | null> | MatchHistoryEntry | null;
  onClose: () => void;
}) {
  const DUEL_SOUND_ENABLED_KEY = "chadchat_duel_sound_enabled_v1";
  const DUEL_SOUND_VOLUME_KEY = "chadchat_duel_sound_volume_v1";
  const extractPhase = useCallback((payload: Record<string, unknown>) =>
    (payload.phase as string | undefined) ??
    (payload.current_phase as string | undefined) ??
    (payload.state as string | undefined) ??
    ((payload.match as Record<string, unknown> | undefined)?.phase as
      | string
      | undefined) ??
    ((payload.match as Record<string, unknown> | undefined)?.current_phase as
      | string
      | undefined) ??
    ((payload.match as Record<string, unknown> | undefined)?.state as
      | string
      | undefined), []);
  const parseMaybeJsonObject = useCallback((value: unknown): Record<string, unknown> | null => {
    if (!value) return null;
    if (typeof value === "object") return value as Record<string, unknown>;
    if (typeof value !== "string") return null;
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
      return null;
    } catch {
      return null;
    }
  }, []);
  const pickSignalPayload = useCallback((payload: Record<string, unknown>) => {
    const candidates: Array<Record<string, unknown>> = [];
    candidates.push(payload);
    const fromSignal = parseMaybeJsonObject(payload.signal);
    if (fromSignal) candidates.push(fromSignal);
    const fromData = parseMaybeJsonObject(payload.data);
    if (fromData) candidates.push(fromData);
    const fromMessage = parseMaybeJsonObject(payload.message);
    if (fromMessage) candidates.push(fromMessage);
    const fromPayload = parseMaybeJsonObject(payload.payload);
    if (fromPayload) candidates.push(fromPayload);

    for (const c of candidates) {
      const type = c.type;
      if (type === "offer" || type === "answer" || type === "ice-candidate") {
        return c;
      }
      const nestedData = parseMaybeJsonObject(c.data);
      if (nestedData) {
        const nestedType = nestedData.type;
        if (
          nestedType === "offer" ||
          nestedType === "answer" ||
          nestedType === "ice-candidate"
        ) {
          return nestedData;
        }
      }
    }
    return null;
  }, [parseMaybeJsonObject]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const duelAudioContextRef = useRef<AudioContext | null>(null);
  const preloadedSoundBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const activeResultSoundSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const makingOfferRef = useRef(false);
  const ignoreOfferRef = useRef(false);
  const mediaReadySentRef = useRef(false);
  const remoteStreamAttachedRef = useRef(false);
  const iceConnectedRef = useRef(false);
  const searchAudioRef = useRef<HTMLAudioElement | null>(null);
  const searchAudioFadeRef = useRef<number | null>(null);
  const lastQueueTrackIndexRef = useRef<number | null>(null);
  const [queueing, setQueueing] = useState(false);
  const [matchID, setMatchID] = useState("");
  const [phase, setPhase] = useState("queue");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [myAvg, setMyAvg] = useState<number | null>(null);
  const [oppAvg, setOppAvg] = useState<number | null>(null);
  const [status, setStatus] = useState("Joining queue...");
  const [error, setError] = useState<string | null>(null);
  const [opponentUserId, setOpponentUserId] = useState<string | null>(null);
  const [myScore, setMyScore] = useState<number | null>(null);
  const [oppScore, setOppScore] = useState<number | null>(null);
  const [resultSummary, setResultSummary] = useState<{
    winnerId: string | null;
    loserId: string | null;
    reason: string | null;
    myFinal: number | null;
    oppFinal: number | null;
    myNickname: string | null;
    oppNickname: string | null;
    ratingDelta: number | null;
  } | null>(null);
  const [mediaReadyMap, setMediaReadyMap] = useState<Record<string, boolean>>({});
  const [queueRunKey, setQueueRunKey] = useState(0);
  const [mediaRunKey, setMediaRunKey] = useState(0);
  const [peerReadyKey, setPeerReadyKey] = useState(0);
  const [searchSoundEnabled, setSearchSoundEnabled] = useState(true);
  const [searchVolume, setSearchVolume] = useState(0.18);
  const [showFinalResult, setShowFinalResult] = useState(false);
  const [myScorePulse, setMyScorePulse] = useState(false);
  const [oppScorePulse, setOppScorePulse] = useState(false);
  const [phaseFlash, setPhaseFlash] = useState(false);
  const [matchCancelled, setMatchCancelled] = useState<{
    reason: string;
    message: string;
  } | null>(null);
  const finishedRef = useRef(false);
  const resultSoundPlayedRef = useRef(false);
  const resultRevealMatchRef = useRef<string | null>(null);
  const lastPhaseRef = useRef<string | null>(null);

  const pushDebug = useCallback((...args: unknown[]) => {
    void args;
  }, []);
  const isOfferer = Boolean(myUserId && opponentUserId && myUserId < opponentUserId);
  const isQueueScreen = queueing || !matchID || phase === "queue";
  const timerMax =
    phase === "awaiting_media"
      ? 0
      : phase === "pre_start" || phase === "post_chat"
      ? 10
      : phase === "overtime"
        ? 5
        : 10;
  const timerProgress = Math.max(
    0,
    Math.min(
      100,
      phase === "awaiting_media"
        ? 0
        : ((secondsLeft ?? timerMax) / Math.max(1, timerMax)) * 100,
    ),
  );
  const phaseLabel =
    phase === "awaiting_media"
      ? "Awaiting Media"
      : phase === "pre_start"
      ? "Pre Start"
      : phase === "scoring"
        ? "Scoring"
        : phase === "overtime"
          ? "Overtime"
          : phase === "result"
            ? "Result"
            : phase === "post_chat"
              ? "Post Chat"
              : phase === "finished"
                ? "Finished"
                : phase === "cancelled"
                  ? "Cancelled"
              : "Queue";
  const phaseToneClass =
    phase === "awaiting_media"
      ? "border-sky-400/40 bg-sky-950/25 text-sky-200"
      : phase === "pre_start"
        ? "border-purple-400/60 bg-purple-950/40 text-purple-100"
        : phase === "scoring"
          ? "border-red-400/70 bg-red-950/40 text-red-100"
          : phase === "overtime"
            ? "border-amber-300/75 bg-amber-950/45 text-amber-100 animate-pulse"
            : phase === "result" || phase === "post_chat" || phase === "finished"
              ? "border-[#d4af37]/70 bg-[#d4af37]/10 text-[#f5d76e]"
              : phase === "cancelled"
                ? "border-red-500/55 bg-red-950/35 text-red-200"
              : "border-zinc-800 bg-zinc-950 text-zinc-400";
  const phaseCommand =
    phase === "awaiting_media"
      ? "WAITING FOR CAMERAS"
      : phase === "pre_start"
        ? "FACE LOCK"
        : phase === "scoring"
          ? "RATING LIVE"
          : phase === "overtime"
            ? "SUDDEN DEATH"
            : phase === "result" || phase === "post_chat" || phase === "finished"
              ? "FINAL JUDGMENT"
              : phase === "cancelled"
                ? "MATCH CANCELLED"
              : "QUEUE ACTIVE";
  const isResultPhase =
    phase === "result" || phase === "post_chat" || phase === "finished";
  const hasResultSummary = Boolean(resultSummary);
  const isTerminalPhase = useCallback((value: string | null | undefined) => {
    return value === "result" || value === "post_chat" || value === "finished";
  }, []);
  const myMediaReady = myUserId ? Boolean(mediaReadyMap[myUserId]) : false;
  const opponentMediaReady = opponentUserId ? Boolean(mediaReadyMap[opponentUserId]) : false;
  const myLost = Boolean(resultSummary?.loserId && myUserId && resultSummary.loserId === myUserId);
  const opponentLost = Boolean(resultSummary?.loserId && myUserId && resultSummary.loserId !== myUserId);
  const scoreLead =
    myAvg !== null && oppAvg !== null ? myAvg - oppAvg : null;
  const myLeading = scoreLead !== null && scoreLead > 0.08;
  const oppLeading = scoreLead !== null && scoreLead < -0.08;
  const activeScoring = phase === "scoring" || phase === "overtime";

  const extractMatchRecord = useCallback((payload: Record<string, unknown>) => {
    return (payload.match as Record<string, unknown> | undefined) ?? payload;
  }, []);

  const ensureDuelAudioContext = useCallback(() => {
    if (typeof window === "undefined") return null;
    const ExistingContext = window.AudioContext || (window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;
    if (!ExistingContext) return null;
    if (!duelAudioContextRef.current) {
      duelAudioContextRef.current = new ExistingContext();
    }
    return duelAudioContextRef.current;
  }, []);

  const preloadResultSound = useCallback(
    async (sound: DuelResultSound | null) => {
      if (!sound?.id || !sound.audio_url) return;
      if (preloadedSoundBuffersRef.current.has(sound.id)) return;
      const audioContext = ensureDuelAudioContext();
      if (!audioContext) return;
      const response = await fetch(sound.audio_url);
      if (!response.ok) {
        throw new Error(`Failed to preload sound: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      preloadedSoundBuffersRef.current.set(sound.id, decoded);
    },
    [ensureDuelAudioContext],
  );

  const preloadResultSoundsMap = useCallback(
    (soundsByUser: Record<string, DuelResultSound>) => {
      void Promise.all(
        Object.values(soundsByUser).map((sound) =>
          preloadResultSound(sound).catch(() => {}),
        ),
      );
    },
    [preloadResultSound],
  );

  const playPreloadedResultSound = useCallback(
    async (soundID: string | null | undefined, fallbackSound?: DuelResultSound | null) => {
      if (!resultSoundEnabled || resultSoundVolume <= 0) return;
      if (!soundID) return;
      const audioContext = ensureDuelAudioContext();
      if (!audioContext) return;
      if (audioContext.state === "suspended") {
        await audioContext.resume().catch(() => {});
      }

      let buffer = preloadedSoundBuffersRef.current.get(soundID);
      if (!buffer && fallbackSound && fallbackSound.id === soundID) {
        await preloadResultSound(fallbackSound).catch(() => {});
        buffer = preloadedSoundBuffersRef.current.get(soundID);
      }
      if (!buffer) return;

      activeResultSoundSourceRef.current?.stop();
      activeResultSoundSourceRef.current = null;
      const source = audioContext.createBufferSource();
      const gain = audioContext.createGain();
      gain.gain.value = Math.max(0, Math.min(1, resultSoundVolume));
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(audioContext.destination);
      source.onended = () => {
        if (activeResultSoundSourceRef.current === source) {
          activeResultSoundSourceRef.current = null;
        }
      };
      activeResultSoundSourceRef.current = source;
      source.start(0);
    },
    [ensureDuelAudioContext, preloadResultSound, resultSoundEnabled, resultSoundVolume],
  );

  const maybeSendMediaReady = useCallback(() => {
    if (!accessToken || !matchID || !streamRef.current) return;
    if (mediaReadySentRef.current) return;
    if (!remoteStreamAttachedRef.current) return;
    if (!iceConnectedRef.current) return;

    mediaReadySentRef.current = true;
    void duelMediaReady(accessToken, matchID).catch((error: unknown) => {
      mediaReadySentRef.current = false;
      setError(error instanceof Error ? error.message : "Failed to confirm media");
    });
  }, [accessToken, matchID]);

  const closePeerConnection = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    remoteStreamRef.current = null;
    mediaReadySentRef.current = false;
    remoteStreamAttachedRef.current = false;
    iceConnectedRef.current = false;
    pendingCandidatesRef.current = [];
    makingOfferRef.current = false;
    ignoreOfferRef.current = false;
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  }, []);

  const stopResultSound = useCallback(() => {
    if (activeResultSoundSourceRef.current) {
      activeResultSoundSourceRef.current.stop();
      activeResultSoundSourceRef.current = null;
    }
  }, []);

  const applyMatchSnapshot = useCallback((payload: Record<string, unknown>) => {
    const match = extractMatchRecord(payload);
    const nextPhase = extractPhase(payload) ?? extractPhase(match);
    if (nextPhase) setPhase(nextPhase);

    const nextSecondsLeft =
      (match.seconds_left as number | undefined) ??
      (payload.seconds_left as number | undefined);
    if (typeof nextSecondsLeft === "number") {
      setSecondsLeft(nextSecondsLeft);
    }

    const players = match.players as Array<Record<string, unknown>> | undefined;
    const mediaReady = match.media_ready as Record<string, boolean> | undefined;
    const rawResultSounds = match.result_sounds as Record<string, unknown> | undefined;
    let normalizedResultSounds: Record<string, DuelResultSound> = {};
    if (mediaReady && typeof mediaReady === "object") {
      setMediaReadyMap(
        Object.fromEntries(
          Object.entries(mediaReady).map(([key, value]) => [key, Boolean(value)]),
        ),
      );
    }
    if (rawResultSounds && typeof rawResultSounds === "object") {
      normalizedResultSounds = Object.fromEntries(
        Object.entries(rawResultSounds)
          .map(([userID, value]) => [userID, normalizeDuelResultSound(value)])
          .filter((entry): entry is [string, DuelResultSound] => Boolean(entry[1])),
      );
      preloadResultSoundsMap(normalizedResultSounds);
    }
    const isActiveMatch = nextPhase === "scoring" || nextPhase === "overtime" || phase === "scoring" || phase === "overtime";

    if (Array.isArray(players) && myUserId) {
      const mine = players.find((player) => String(player.user_id ?? "") === myUserId);
      const opponent = players.find((player) => String(player.user_id ?? "") !== myUserId);

      if (mine) {
        const mineAvg =
          (mine.running_avg as number | undefined) ??
          (mine.final_avg as number | undefined);
        const mineScore = mine.last_score as number | undefined;
        if (typeof mineAvg === "number") setMyAvg(mineAvg);
        // Don't overwrite score from polling during active scoring — SSE provides real-time updates
        if (typeof mineScore === "number" && !isActiveMatch) setMyScore(mineScore);
      }

      if (opponent) {
        const opponentId = opponent.user_id ? String(opponent.user_id) : null;
        const opponentAvg =
          (opponent.running_avg as number | undefined) ??
          (opponent.final_avg as number | undefined);
        const opponentScore = opponent.last_score as number | undefined;
        if (opponentId) setOpponentUserId(opponentId);
        if (typeof opponentAvg === "number") setOppAvg(opponentAvg);
        // Don't overwrite score from polling during active scoring — SSE provides real-time updates
        if (typeof opponentScore === "number" && !isActiveMatch) setOppScore(opponentScore);
      }

      const result = match.result as Record<string, unknown> | undefined;
      if (result) {
        const winnerId = result.winner_id ? String(result.winner_id) : null;
        setResultSummary({
          winnerId,
          loserId: result.loser_id ? String(result.loser_id) : null,
          reason: result.reason ? String(result.reason) : null,
          myFinal:
            mine && typeof mine.final_avg === "number"
              ? (mine.final_avg as number)
              : mine && typeof mine.running_avg === "number"
                ? (mine.running_avg as number)
                : null,
          oppFinal:
            opponent && typeof opponent.final_avg === "number"
              ? (opponent.final_avg as number)
              : opponent && typeof opponent.running_avg === "number"
                ? (opponent.running_avg as number)
                : null,
          myNickname: mine?.nickname ? String(mine.nickname) : null,
          oppNickname: opponent?.nickname ? String(opponent.nickname) : null,
          ratingDelta: null,
        });
        if (nextPhase === "result" && winnerId && !resultSoundPlayedRef.current) {
          const winnerSound = normalizedResultSounds[winnerId];
          resultSoundPlayedRef.current = true;
          void playPreloadedResultSound(winnerSound?.id, winnerSound);
        }
      }
    }

    const directOpponent =
      (match.player_a as string | undefined) === myUserId
        ? (match.player_b as string | undefined)
        : (match.player_b as string | undefined) === myUserId
          ? (match.player_a as string | undefined)
          : undefined;
    if (directOpponent) {
      setOpponentUserId(directOpponent);
    }
  }, [extractMatchRecord, extractPhase, myUserId, playPreloadedResultSound, preloadResultSoundsMap]);

  const resetMatchFlow = useCallback(() => {
    stopResultSound();
    finishedRef.current = false;
    resultSoundPlayedRef.current = false;
    resultRevealMatchRef.current = null;
    lastPhaseRef.current = null;
    mediaReadySentRef.current = false;
    remoteStreamAttachedRef.current = false;
    iceConnectedRef.current = false;
    setQueueing(false);
    setMatchID("");
    setPeerReadyKey(0);
    setPhase("queue");
    setSecondsLeft(null);
    setMyAvg(null);
    setOppAvg(null);
    setMyScore(null);
    setOppScore(null);
    setOpponentUserId(null);
    setResultSummary(null);
    setMediaReadyMap({});
    setStatus("Joining queue...");
    setError(null);
    setShowFinalResult(false);
    setMatchCancelled(null);
    remoteStreamRef.current = null;
    preloadedSoundBuffersRef.current.clear();
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (!streamRef.current) {
      setMediaRunKey((current) => current + 1);
    }
    setQueueRunKey((current) => current + 1);
  }, [stopResultSound]);

  const stopSearchAudio = useCallback(() => {
    if (searchAudioFadeRef.current) {
      window.clearInterval(searchAudioFadeRef.current);
      searchAudioFadeRef.current = null;
    }
    if (searchAudioRef.current) {
      searchAudioRef.current.pause();
      searchAudioRef.current.currentTime = 0;
      searchAudioRef.current = null;
    }
  }, []);

  const startSearchAudio = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (searchAudioRef.current) return;

    try {
      let nextIndex = Math.floor(Math.random() * duelQueueTracks.length);
      if (duelQueueTracks.length > 1 && lastQueueTrackIndexRef.current === nextIndex) {
        nextIndex = (nextIndex + 1) % duelQueueTracks.length;
      }
      lastQueueTrackIndexRef.current = nextIndex;
      const audio = new Audio(duelQueueTracks[nextIndex]);
      audio.loop = true;
      audio.volume = 0.001;
      searchAudioRef.current = audio;
      await audio.play();

      let currentVolume = 0.001;
      searchAudioFadeRef.current = window.setInterval(() => {
        if (!searchAudioRef.current) return;
        currentVolume = Math.min(searchVolume, currentVolume + 0.016);
        searchAudioRef.current.volume = currentVolume;
        if (currentVolume >= searchVolume && searchAudioFadeRef.current) {
          window.clearInterval(searchAudioFadeRef.current);
          searchAudioFadeRef.current = null;
        }
      }, 90);
    } catch {
      stopSearchAudio();
    }
  }, [stopSearchAudio, searchVolume]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedEnabled = window.localStorage.getItem(DUEL_SOUND_ENABLED_KEY);
    const storedVolume = window.localStorage.getItem(DUEL_SOUND_VOLUME_KEY);
    if (storedEnabled !== null) {
      setSearchSoundEnabled(storedEnabled === "1");
    }
    if (storedVolume !== null) {
      const parsed = Number(storedVolume);
      if (Number.isFinite(parsed)) {
        setSearchVolume(Math.max(0, Math.min(1, parsed)));
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(DUEL_SOUND_ENABLED_KEY, searchSoundEnabled ? "1" : "0");
  }, [searchSoundEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(DUEL_SOUND_VOLUME_KEY, String(searchVolume));
    if (searchAudioRef.current && !searchAudioFadeRef.current) {
      searchAudioRef.current.volume = searchVolume;
    }
  }, [searchVolume]);

  useEffect(() => {
    if (myScore === null) return;
    setMyScorePulse(true);
    const timer = window.setTimeout(() => setMyScorePulse(false), 320);
    return () => window.clearTimeout(timer);
  }, [myScore]);

  useEffect(() => {
    if (oppScore === null) return;
    setOppScorePulse(true);
    const timer = window.setTimeout(() => setOppScorePulse(false), 320);
    return () => window.clearTimeout(timer);
  }, [oppScore]);

  useEffect(() => {
    if (phase === "queue" || lastPhaseRef.current === phase) return;
    lastPhaseRef.current = phase;
    setPhaseFlash(true);
    const timer = window.setTimeout(() => setPhaseFlash(false), 540);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const extractUsersFromMatch = useCallback((payload: Record<string, unknown>) => {
    const match = (payload.match as Record<string, unknown> | undefined) ?? payload;
    const directOpponent =
      (match.opponent_user_id as string | undefined) ??
      (match.enemy_user_id as string | undefined);
    if (directOpponent) return { opponent: directOpponent };
    const users = match.users as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(users) && myUserId) {
      const other = users.find((u) => String(u.id ?? "") !== myUserId);
      if (other?.id) return { opponent: String(other.id) };
    }
    return { opponent: null };
  }, [myUserId]);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 360;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    return dataUrl.split(",")[1] ?? null;
  }, []);

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: true,
        });
        if (!mounted) return;
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.muted = true;
          videoRef.current.autoplay = true;
          videoRef.current.playsInline = true;
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        if (mounted) setError("Camera access denied");
      }
    };
    void init();
    return () => {
      mounted = false;
      remoteStreamRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [mediaRunKey]);

  useEffect(() => {
    const attachLocal = async () => {
      if (!videoRef.current || !streamRef.current) return;
      videoRef.current.muted = true;
      videoRef.current.autoplay = true;
      videoRef.current.playsInline = true;
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
      await videoRef.current.play().catch(() => {});
    };

    const attachRemote = async () => {
      if (!remoteVideoRef.current || !remoteStreamRef.current) return;
      remoteVideoRef.current.autoplay = true;
      remoteVideoRef.current.playsInline = true;
      if (remoteVideoRef.current.srcObject !== remoteStreamRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
      }
      await remoteVideoRef.current.play().catch(() => {});
    };

    void attachLocal();
    void attachRemote();
  }, [isQueueScreen, matchID, phase]);

  useEffect(() => {
    if (!accessToken || !matchID || !streamRef.current) return;
    let cancelled = false;
    let pc: RTCPeerConnection | null = null;

    const waitForRemoteVideo = (video: HTMLVideoElement) =>
      new Promise<void>((resolve) => {
        if (video.readyState >= 2) {
          resolve();
          return;
        }
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          video.removeEventListener("loadeddata", done);
          video.removeEventListener("playing", done);
          resolve();
        };
        video.addEventListener("loadeddata", done, { once: true });
        video.addEventListener("playing", done, { once: true });
        window.setTimeout(done, 3000);
      });

    const initPeer = async () => {
      const rtcConfig = await duelRtcConfig(accessToken);
      if (cancelled) return;
      if (!rtcConfig.ice_servers?.length) {
        throw new Error("RTC config is missing ICE servers");
      }
      pc = new RTCPeerConnection({
        iceServers: rtcConfig.ice_servers,
      });
      peerRef.current = pc;
      makingOfferRef.current = false;
      ignoreOfferRef.current = false;
      mediaReadySentRef.current = false;
      remoteStreamAttachedRef.current = false;
      iceConnectedRef.current = false;
      pendingCandidatesRef.current = [];

      const localStream = streamRef.current;
      if (!localStream) return;
      for (const track of localStream.getTracks()) {
        pc.addTrack(track, localStream);
      }
      setPeerReadyKey((current) => current + 1);

      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (!remoteStream) return;
        remoteStreamRef.current = remoteStream;
        const remoteVideo = remoteVideoRef.current;
        if (remoteVideo) {
          remoteVideo.autoplay = true;
          remoteVideo.playsInline = true;
          remoteVideo.srcObject = remoteStream;
          void (async () => {
            await remoteVideo.play().catch(() => {});
            await waitForRemoteVideo(remoteVideo);
            if (cancelled) return;
            remoteStreamAttachedRef.current = true;
            maybeSendMediaReady();
          })();
        }
        pushDebug(`ontrack: remote tracks=${remoteStream.getTracks().length}`);
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        pushDebug("local ICE candidate -> signal");
        void duelSignal(accessToken, matchID, {
          type: "ice-candidate",
          candidate: event.candidate.candidate,
          sdp_mid: event.candidate.sdpMid,
          sdp_mline_index: event.candidate.sdpMLineIndex,
        }).catch(() => {});
      };

      pc.onconnectionstatechange = () => {
        pushDebug(`pc.connectionState=${pc?.connectionState}`);
      };
      pc.oniceconnectionstatechange = () => {
        const state = pc?.iceConnectionState;
        pushDebug(`pc.iceConnectionState=${state}`);
        if (state === "connected" || state === "completed") {
          iceConnectedRef.current = true;
          maybeSendMediaReady();
        }
      };
      pc.onsignalingstatechange = () => {
        pushDebug(`pc.signalingState=${pc?.signalingState}`);
      };
    };

    void initPeer().catch((error: unknown) => {
      if (!cancelled) setError(error instanceof Error ? error.message : "Failed to start call");
    });

    return () => {
      cancelled = true;
      closePeerConnection();
    };
  }, [accessToken, matchID, pushDebug, maybeSendMediaReady, closePeerConnection]);

  useEffect(() => {
    if (!accessToken || !matchID || !peerRef.current) return;
    if (!isOfferer) return;
    const pc = peerRef.current;
    if (pc.signalingState !== "stable") return;
    if (pc.localDescription) return;
    void (async () => {
      try {
        makingOfferRef.current = true;
        pushDebug("deterministic offerer -> create offer");
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await pc.setLocalDescription(offer);
        await duelSignal(accessToken, matchID, {
          type: "offer",
          sdp: offer.sdp ?? "",
        });
        pushDebug("offer sent");
      } catch {
        pushDebug("offer error");
      } finally {
        makingOfferRef.current = false;
      }
    })();
  }, [accessToken, matchID, isOfferer, pushDebug, opponentUserId, peerReadyKey]);

  useEffect(() => {
    if (!accessToken) return;
    let mounted = true;
    let poll: number | null = null;
    setQueueing(true);
    setError(null);

    const start = async () => {
      try {
        const joined = await duelQueueJoin(accessToken);
        const directMatch = String((joined.match_id as string | undefined) ?? "");
        const joinedPhase = extractPhase(joined as Record<string, unknown>);
        if (directMatch && mounted && !isTerminalPhase(joinedPhase)) {
          setMatchID(directMatch);
          setStatus("Match found");
          setQueueing(false);
          return;
        }
        setStatus("Queueing for opponent...");
        poll = window.setInterval(async () => {
          try {
            const current = await duelCurrentMatch(accessToken);
            const currentPhase = extractPhase(current as Record<string, unknown>);
            const id = String(
              (current.match_id as string | undefined) ??
                ((current.match as Record<string, unknown> | undefined)?.id as
                  | string
                  | undefined) ??
                "",
            );
            if (id && mounted && !isTerminalPhase(currentPhase)) {
              setMatchID(id);
              setStatus("Match found");
              setQueueing(false);
              if (poll) window.clearInterval(poll);
            }
          } catch {
            // ignore transient poll errors
          }
        }, 1500);
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : "Failed to join queue");
        setQueueing(false);
      }
    };
    void start();

    return () => {
      mounted = false;
      if (poll) window.clearInterval(poll);
      if (accessToken) {
        void duelQueueLeave(accessToken);
      }
    };
  }, [accessToken, queueRunKey, extractPhase, isTerminalPhase]);

  useEffect(() => {
    if (isQueueScreen && searchSoundEnabled) {
      void startSearchAudio();
      return;
    }
    stopSearchAudio();
  }, [isQueueScreen, searchSoundEnabled, startSearchAudio, stopSearchAudio]);

  useEffect(() => {
    if (!accessToken || !matchID) return;
    const controller = new AbortController();
    let mounted = true;
    let poll: number | null = null;

    const syncMatch = async () => {
      try {
        const match = await duelGetMatch(accessToken, matchID);
        if (!mounted) return;
        applyMatchSnapshot(match as Record<string, unknown>);
      } catch {
        // keep stream running
      }
    };

    poll = window.setInterval(() => void syncMatch(), 1500);
    void syncMatch();

    void duelStream(
      accessToken,
      matchID,
      (event, data) => {
        const payload = data as Record<string, unknown>;
        pushDebug(`sse event=${event}`);
        pushDebug(`sse keys=${Object.keys(payload).join(",") || "-"}`);
        const msgType = (payload.type as string | undefined) ?? event;
        const body = (payload.payload as Record<string, unknown> | undefined) ?? payload;

        if (
          msgType === "joined" ||
          msgType === "match_found" ||
          msgType === "phase_changed" ||
          msgType === "result_sounds_updated" ||
          msgType === "media_ready_update"
        ) {
          applyMatchSnapshot(payload);
          const p = extractPhase(payload) ?? extractPhase(body);
          if (p) {
            if (p === "awaiting_media") setStatus("Waiting for both cameras");
            if (p === "pre_start") setStatus("Opponent connected");
            if (p === "scoring") setStatus("Scoring in progress");
            if (p === "overtime") setStatus("Overtime round");
            if (p === "result") setStatus("Calculating result");
            if (p === "post_chat") setStatus("Post chat");
            if (p === "finished") setStatus("Match finished");
          }
          if (
            msgType === "media_ready_update" &&
            (payload.media_grace_phase === true || body.media_grace_phase === true)
          ) {
            setStatus("Stabilizing connection...");
          }
        }
        if (msgType === "match_cancelled") {
          const reason = String(payload.reason ?? body.reason ?? "media_disconnect");
          stopSearchAudio();
          stopResultSound();
          closePeerConnection();
          streamRef.current?.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          setQueueing(false);
          setPhase("cancelled");
          setStatus("Match cancelled");
          setSecondsLeft(null);
          setMatchCancelled({
            reason,
            message:
              reason === "media_disconnect"
                ? "Opponent disconnected before media was ready"
                : "The match was cancelled before it started",
          });
          return;
        }
        if (msgType === "timer") {
          if (typeof payload.seconds_left === "number") setSecondsLeft(payload.seconds_left);
          if (typeof body.seconds_left === "number") setSecondsLeft(body.seconds_left);
        }
        if (msgType === "score_update") {
          if (typeof body.my_score === "number") setMyScore(body.my_score);
          if (typeof body.my_running_avg === "number") setMyAvg(body.my_running_avg);
          if (typeof body.opponent_score === "number") setOppScore(body.opponent_score);
          if (typeof body.opponent_running === "number") setOppAvg(body.opponent_running);
          if (typeof body.seconds_left === "number") setSecondsLeft(body.seconds_left);
        }
        if (msgType === "finished") {
          applyMatchSnapshot(payload);
          setPhase("finished");
          setStatus("Match finished");
          const winnerSoundId =
            (payload.winner_result_sound_id as string | undefined) ??
            (body.winner_result_sound_id as string | undefined) ??
            null;
          const winnerSound =
            normalizeDuelResultSound(payload.winner_result_sound) ??
            normalizeDuelResultSound(body.winner_result_sound);
          if (!resultSoundPlayedRef.current) {
            resultSoundPlayedRef.current = true;
            void playPreloadedResultSound(winnerSoundId, winnerSound);
          }
          if (!finishedRef.current) {
            finishedRef.current = true;
            void Promise.resolve(onFinished?.()).then((latestMatch) => {
              if (!latestMatch || typeof latestMatch.rating_delta !== "number") return;
              setResultSummary((current) =>
                current
                  ? {
                      ...current,
                      ratingDelta: latestMatch.rating_delta ?? null,
                      myFinal:
                        typeof latestMatch.my_score === "number"
                          ? latestMatch.my_score
                          : current.myFinal,
                      oppFinal:
                        typeof latestMatch.opponent_score === "number"
                          ? latestMatch.opponent_score
                          : current.oppFinal,
                      oppNickname: latestMatch.opponent_nickname ?? current.oppNickname,
                    }
                  : current,
              );
            });
          }
        }
        const signalPayload =
          msgType === "webrtc_signal"
            ? ((payload.payload as Record<string, unknown> | undefined) ?? payload)
            : pickSignalPayload(payload);

        if (signalPayload) {
          const type =
            (signalPayload.signal_type as string | undefined) ??
            (signalPayload.type as string | undefined);
          const fromUserId =
            (signalPayload.from_user_id as string | undefined) ?? null;
          const toUserId =
            (signalPayload.to_user_id as string | undefined) ?? null;
          if (fromUserId && myUserId && fromUserId === myUserId) {
            pushDebug("ignore own signal");
            return;
          }
          if (toUserId && myUserId && toUserId !== myUserId) return;
          const pc = peerRef.current;
          if (!pc || !type) return;
          pushDebug(`signal type=${type}`);

          const handle = async () => {
            if (type === "offer") {
              const sdp = signalPayload.sdp as string | undefined;
              if (!sdp) return;
              const offerCollision =
                makingOfferRef.current || pc.signalingState !== "stable";
              ignoreOfferRef.current = false;
              if (ignoreOfferRef.current) return;
              if (offerCollision) {
                await pc.setLocalDescription({ type: "rollback" });
                pushDebug("rollback local description");
              }
              await pc.setRemoteDescription({ type: "offer", sdp });
              pushDebug("remote offer set");
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              pushDebug("local answer set");
              await duelSignal(accessToken, matchID, {
                type: "answer",
                sdp: answer.sdp,
              });
              pushDebug("answer sent");
              for (const c of pendingCandidatesRef.current) {
                await pc.addIceCandidate(c);
              }
              pendingCandidatesRef.current = [];
              return;
            }

            if (type === "answer") {
              const sdp = signalPayload.sdp as string | undefined;
              if (!sdp) return;
              if (pc.signalingState !== "have-local-offer") return;
              await pc.setRemoteDescription({ type: "answer", sdp });
              pushDebug("remote answer set");
              for (const c of pendingCandidatesRef.current) {
                await pc.addIceCandidate(c);
              }
              pendingCandidatesRef.current = [];
              return;
            }

            if (type === "ice-candidate") {
              const candidate = signalPayload.candidate as string | undefined;
              if (!candidate) return;
              const ice: RTCIceCandidateInit = {
                candidate,
                sdpMid: (signalPayload.sdp_mid as string | undefined) ?? undefined,
                sdpMLineIndex:
                  (signalPayload.sdp_mline_index as number | undefined) ?? undefined,
              };
              if (pc.remoteDescription) {
                try {
                  await pc.addIceCandidate(ice);
                  pushDebug("remote ICE applied");
                } catch {
                  if (!ignoreOfferRef.current) throw new Error("Cannot add ICE candidate");
                }
              } else {
                pendingCandidatesRef.current.push(ice);
                pushDebug("remote ICE queued");
              }
            }
          };

          void handle().catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            pushDebug(`signal handle error: ${type} (${message})`);
          });
        }
      },
      controller.signal,
    ).catch(() => {
      pushDebug("sse stream ended");
    });

    return () => {
      mounted = false;
      if (poll) window.clearInterval(poll);
      controller.abort();
    };
  }, [accessToken, matchID, pushDebug, pickSignalPayload, myUserId, extractUsersFromMatch, onFinished, applyMatchSnapshot, extractPhase, playPreloadedResultSound, stopSearchAudio, stopResultSound, closePeerConnection]);

  useEffect(() => {
    if (!accessToken || !matchID) return;
    if (!(phase === "scoring" || phase === "overtime")) return;
    const id = window.setInterval(async () => {
      const frame = captureFrame();
      if (!frame) return;
      try {
        await duelScoreFrame(accessToken, matchID, frame);
        setError(null);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Frame upload failed");
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [accessToken, matchID, phase, captureFrame]);

  useEffect(() => {
    if (!isResultPhase || !hasResultSummary) {
      resultRevealMatchRef.current = null;
      setShowFinalResult(false);
      return;
    }
    if (resultRevealMatchRef.current === matchID) return;
    resultRevealMatchRef.current = matchID;
    setShowFinalResult(false);
    const timer = window.setTimeout(() => {
      setShowFinalResult(true);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [isResultPhase, hasResultSummary, matchID]);

  useEffect(() => {
    const soundBuffers = preloadedSoundBuffersRef.current;
    const audioContext = duelAudioContextRef.current;
    return () => {
      stopSearchAudio();
      stopResultSound();
      soundBuffers.clear();
      audioContext?.close().catch(() => {});
      if (duelAudioContextRef.current === audioContext) {
        duelAudioContextRef.current = null;
      }
    };
  }, [stopSearchAudio, stopResultSound]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-hidden bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="duel-title"
      onMouseDown={onClose}
    >
      <div
        className="flex h-screen w-full flex-col overflow-hidden border-x-0 border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)] sm:h-[calc(100vh-1.5rem)] sm:max-w-[1500px] sm:border"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id="duel-title" className="text-lg font-black uppercase tracking-[0.14em] text-zinc-100">
            1v1 Mogging
          </h2>
          <button
            className="inline-flex h-10 w-10 items-center justify-center border border-zinc-800 bg-black/80 text-zinc-400 transition-colors hover:border-purple-400 hover:text-white"
            onClick={() => {
              stopResultSound();
              onClose();
            }}
            type="button"
            aria-label="Close duel"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4">
          {matchCancelled ? (
            <div className="flex min-h-[72vh] flex-col items-center justify-center border border-red-500/35 bg-black/85 px-6 text-center">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-red-300">
                Match Cancelled
              </div>
              <div className="mt-4 text-3xl font-black uppercase tracking-[0.14em] text-zinc-100">
                Connection Lost
              </div>
              <div className="mt-3 max-w-md text-sm uppercase tracking-[0.12em] text-zinc-500">
                {matchCancelled.message}
              </div>
              <div className="mt-4 border border-zinc-800 bg-zinc-950 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                Reason: {matchCancelled.reason}
              </div>
              <div className="mt-8 grid w-full max-w-md gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={resetMatchFlow}
                  className="inline-flex h-11 items-center justify-center border border-purple-500/50 bg-purple-950/35 px-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-purple-100 transition-colors hover:border-purple-300 hover:text-white"
                >
                  Find Another Match
                </button>
                <button
                  type="button"
                  onClick={() => {
                    stopResultSound();
                    onClose();
                  }}
                  className="inline-flex h-11 items-center justify-center border border-zinc-800 bg-black/70 px-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
                >
                  Close
                </button>
              </div>
            </div>
          ) : isQueueScreen ? (
            <div className="flex min-h-[72vh] flex-col items-center justify-center border border-zinc-800 bg-black/80 px-6 text-center">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                Matchmaking
              </div>
              <div className="mt-4 h-14 w-14 animate-spin rounded-full border-2 border-zinc-800 border-t-purple-300" />
              <div className="mt-6 text-2xl font-black uppercase tracking-[0.14em] text-zinc-100">
                Finding Opponent
              </div>
              <div className="mt-3 text-sm uppercase tracking-[0.12em] text-zinc-500">
                {status || "Searching for a live 1v1 match"}
              </div>
              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {[
                  ["Mode", "1v1 Ranked"],
                  ["Region", "Auto"],
                  ["Status", "Queue Active"],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="border border-zinc-800 bg-black/70 px-4 py-3"
                  >
                    <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                      {label}
                    </div>
                    <div className="mt-2 text-xs font-black uppercase tracking-[0.12em] text-zinc-200">
                      {value}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 w-full max-w-md border border-zinc-800 bg-zinc-950 p-4 text-left">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                    {searchSoundEnabled ? (
                      <Volume2 className="h-3.5 w-3.5 text-purple-300" aria-hidden="true" />
                    ) : (
                      <VolumeX className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
                    )}
                    Matchmaking Sound
                  </div>
                  <button
                    type="button"
                    onClick={() => setSearchSoundEnabled((current) => !current)}
                    className="inline-flex h-9 items-center justify-center border border-zinc-800 bg-black px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-300 transition-colors hover:border-purple-400 hover:text-white"
                  >
                    {searchSoundEnabled ? "Sound On" : "Sound Off"}
                  </button>
                </div>
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                    <span>Volume</span>
                    <span className="text-zinc-300">{Math.round(searchVolume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={searchVolume}
                    onChange={(event) => setSearchVolume(Number(event.target.value))}
                    className="w-full accent-purple-400"
                  />
                </div>
              </div>
              {error && (
                <div className="mt-6 border border-red-500/45 bg-red-950/35 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-200">
                  {error}
                </div>
              )}
            </div>
          ) : (
            <div
              className={cn(
                "relative grid h-full min-h-0 grid-rows-[auto_1fr_1fr] gap-2 overflow-hidden border bg-black p-2 pb-20 sm:gap-3 sm:p-3 sm:pb-24 lg:grid-cols-2 lg:grid-rows-[auto_minmax(0,1fr)]",
                phase === "awaiting_media" && "border-sky-500/35",
                phase === "pre_start" && "border-purple-500/45",
                phase === "scoring" && "border-red-500/55",
                phase === "overtime" && "border-amber-400/60",
                isResultPhase && "border-[#d4af37]/55",
              )}
            >
              {phaseFlash && (
                <div className="pointer-events-none absolute inset-0 z-40 bg-white/10 duel-flash" />
              )}

              <div className="z-30 grid gap-2 sm:gap-3 lg:col-span-2 lg:grid-cols-[1fr_auto_1fr] lg:items-start">
                <div className="border border-purple-500/45 bg-zinc-950 px-3 py-1.5 shadow-[0_0_22px_rgba(168,85,247,0.18)] sm:px-4 sm:py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[9px] font-black uppercase tracking-[0.16em] text-zinc-100 sm:text-[10px]">
                      {resultSummary?.myNickname ?? "You"}
                    </span>
                    <span className="shrink-0 text-[8px] font-semibold uppercase tracking-[0.14em] text-purple-200 sm:text-[9px]">
                      {myMediaReady ? "LOCKED IN" : "LOCAL"}
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden bg-zinc-900 sm:mt-2 sm:h-1.5">
                    <div
                      className="h-full bg-purple-300 shadow-[0_0_14px_rgba(216,180,254,0.75)] transition-[width] duration-300"
                      style={{ width: `${Math.max(5, Math.min(100, (myAvg ?? 0) * 20))}%` }}
                    />
                  </div>
                </div>

                <div className={cn("border px-3 py-2 text-center shadow-[0_0_28px_rgba(0,0,0,0.7)] sm:px-5 sm:py-3", phaseToneClass)}>
                  <div className="text-[9px] font-black uppercase tracking-[0.2em] sm:text-[10px]">
                    {phaseCommand}
                  </div>
                  <div className="mt-0.5 text-2xl font-black tabular-nums leading-none text-zinc-100 sm:mt-1 sm:text-4xl">
                    {phase === "awaiting_media" ? "VS" : secondsLeft ?? "VS"}
                  </div>
                  <div className="mt-1 text-[8px] font-semibold uppercase tracking-[0.14em] text-zinc-400 sm:mt-2 sm:text-[9px]">
                    {phaseLabel}
                  </div>
                </div>

                <div className="border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-right shadow-[0_0_22px_rgba(255,255,255,0.06)] sm:px-4 sm:py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="shrink-0 text-[8px] font-semibold uppercase tracking-[0.14em] text-zinc-400 sm:text-[9px]">
                      {opponentMediaReady ? "LOCKED IN" : "REMOTE"}
                    </span>
                    <span className="truncate text-[9px] font-black uppercase tracking-[0.16em] text-zinc-100 sm:text-[10px]">
                      {resultSummary?.oppNickname ?? "Opponent"}
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden bg-zinc-900 sm:mt-2 sm:h-1.5">
                    <div
                      className="ml-auto h-full bg-zinc-300 shadow-[0_0_14px_rgba(244,244,245,0.45)] transition-[width] duration-300"
                      style={{ width: `${Math.max(5, Math.min(100, (oppAvg ?? 0) * 20))}%` }}
                    />
                  </div>
                </div>
              </div>

              <div
                className={cn(
                  "group relative min-h-0 overflow-hidden border bg-black/90",
                  myLeading && activeScoring
                    ? "border-emerald-300/80 shadow-[0_0_30px_rgba(110,231,183,0.18)]"
                    : "border-purple-500/45 shadow-[0_0_24px_rgba(168,85,247,0.12)]",
                  myScorePulse && "scale-[1.005]",
                )}
              >
                <video
                  ref={videoRef}
                  className="h-full w-full object-cover"
                  muted
                  playsInline
                  autoPlay
                />
                <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/80 to-transparent" />
                {activeScoring && (
                  <div className="pointer-events-none absolute inset-0 overflow-hidden">
                    <div className="duel-scanline absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-transparent via-red-400/20 to-transparent" />
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[length:100%_6px]" />
                  </div>
                )}
                <div className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] border border-purple-500/55 bg-zinc-950/95 px-2.5 py-2 shadow-[0_0_24px_rgba(0,0,0,0.62)] sm:bottom-4 sm:left-4 sm:px-4 sm:py-3">
                  <div className="text-[9px] font-black uppercase tracking-[0.14em] text-purple-200 sm:text-[10px]">
                    Score
                  </div>
                  <div
                    className={cn(
                      "mt-0.5 text-2xl font-black tabular-nums leading-none text-zinc-100 transition-transform duration-200 sm:mt-1 sm:text-4xl lg:text-5xl",
                      myScorePulse && "scale-110 text-purple-100",
                    )}
                  >
                    {myScore === null ? "--" : `${(myScore * 2).toFixed(1)}/10`}
                  </div>
                  <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500 sm:mt-2 sm:text-[10px]">
                    Avg {myAvg === null ? "--" : `${(myAvg * 2).toFixed(1)}/10`}
                  </div>
                </div>
                {isResultPhase && resultSummary && !showFinalResult && myLost && (
                  <div className="pointer-events-none absolute inset-x-[12%] top-[30%] z-20 flex justify-center">
                    <div className="duel-shake border border-red-500/80 bg-red-950/80 px-7 py-3 text-4xl font-black uppercase tracking-[0.2em] text-red-200 shadow-[0_0_30px_rgba(248,113,113,0.5)] drop-shadow-[0_0_18px_rgba(248,113,113,0.8)]">
                      MOGGED
                    </div>
                  </div>
                )}
              </div>

              <div
                className={cn(
                  "group relative min-h-0 overflow-hidden border bg-black/90",
                  oppLeading && activeScoring
                    ? "border-emerald-300/80 shadow-[0_0_30px_rgba(110,231,183,0.18)]"
                    : "border-zinc-700 shadow-[0_0_24px_rgba(255,255,255,0.06)]",
                  oppScorePulse && "scale-[1.005]",
                )}
              >
                <video
                  ref={remoteVideoRef}
                  className="h-full w-full object-cover"
                  playsInline
                  autoPlay
                />
                <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/80 to-transparent" />
                {activeScoring && (
                  <div className="pointer-events-none absolute inset-0 overflow-hidden">
                    <div className="duel-scanline absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-transparent via-red-400/20 to-transparent" />
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[length:100%_6px]" />
                  </div>
                )}
                <div className="absolute bottom-2 right-2 max-w-[calc(100%-1rem)] border border-zinc-600 bg-zinc-950/95 px-2.5 py-2 text-right shadow-[0_0_24px_rgba(0,0,0,0.62)] sm:bottom-4 sm:right-4 sm:px-4 sm:py-3">
                  <div className="text-[9px] font-black uppercase tracking-[0.14em] text-zinc-400 sm:text-[10px]">
                    Score
                  </div>
                  <div
                    className={cn(
                      "mt-0.5 text-2xl font-black tabular-nums leading-none text-zinc-100 transition-transform duration-200 sm:mt-1 sm:text-4xl lg:text-5xl",
                      oppScorePulse && "scale-110 text-zinc-50",
                    )}
                  >
                    {oppScore === null ? "--" : `${(oppScore * 2).toFixed(1)}/10`}
                  </div>
                  <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500 sm:mt-2 sm:text-[10px]">
                    Avg {oppAvg === null ? "--" : `${(oppAvg * 2).toFixed(1)}/10`}
                  </div>
                </div>
                {isResultPhase && resultSummary && !showFinalResult && opponentLost && (
                  <div className="pointer-events-none absolute inset-x-[12%] top-[30%] z-20 flex justify-center">
                    <div className="duel-shake border border-red-500/80 bg-red-950/80 px-7 py-3 text-4xl font-black uppercase tracking-[0.2em] text-red-200 shadow-[0_0_30px_rgba(248,113,113,0.5)] drop-shadow-[0_0_18px_rgba(248,113,113,0.8)]">
                      MOGGED
                    </div>
                  </div>
                )}
              </div>

              <div className="absolute inset-x-2 bottom-2 z-20 sm:inset-x-3 sm:bottom-3 lg:inset-x-6">
                <div className={cn("border bg-zinc-950/95 px-3 py-2 shadow-[0_0_24px_rgba(0,0,0,0.42)] sm:px-4 sm:py-3", phaseToneClass)}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500 sm:mb-2 sm:gap-4 sm:text-[10px]">
                    <span className="truncate">{status || "Live Match"}</span>
                    <span className="shrink-0 text-zinc-100">{secondsLeft ?? 0}s</span>
                  </div>
                  {phase === "awaiting_media" && (
                    <div className="mb-3 grid gap-2 sm:grid-cols-2">
                      <div className="border border-zinc-800 bg-black px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                        You:{" "}
                        <span className={myMediaReady ? "text-emerald-300" : "text-zinc-500"}>
                          {myMediaReady ? "Ready" : "Waiting"}
                        </span>
                      </div>
                      <div className="border border-zinc-800 bg-black px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                        Opponent:{" "}
                        <span
                          className={opponentMediaReady ? "text-emerald-300" : "text-zinc-500"}
                        >
                          {opponentMediaReady ? "Ready" : "Waiting"}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="h-2 overflow-hidden border border-zinc-800 bg-black">
                    <div
                      className={cn(
                        "h-full transition-[width] duration-300 ease-out",
                        phase === "overtime"
                          ? "bg-amber-300 shadow-[0_0_14px_rgba(252,211,77,0.85)]"
                          : phase === "scoring"
                            ? "bg-red-400 shadow-[0_0_14px_rgba(248,113,113,0.85)]"
                            : "bg-purple-400 shadow-[0_0_14px_rgba(168,85,247,0.8)]",
                      )}
                      style={{ width: `${timerProgress}%` }}
                    />
                  </div>
                </div>
                {error && (
                  <div className="mt-3 border border-red-500/45 bg-red-950/35 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-200">
                    {error}
                  </div>
                )}
              </div>

              {isResultPhase && resultSummary && showFinalResult && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/90 p-3 sm:p-6">
                  <div className="w-full max-w-xl border border-purple-500/35 bg-zinc-950 p-4 text-center shadow-[0_0_40px_rgba(132,0,255,0.22)] sm:p-6">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                      Match Result
                    </div>
                    <div className="mt-3 text-2xl font-black uppercase tracking-[0.14em] text-zinc-100 sm:mt-4 sm:text-3xl">
                      {resultSummary.winnerId && myUserId && resultSummary.winnerId === myUserId
                        ? "Victory"
                        : resultSummary.winnerId
                          ? "Defeat"
                          : "Finished"}
                    </div>
                    <div className="mt-2 text-xs uppercase tracking-[0.12em] text-zinc-500 sm:mt-3">
                      {resultSummary.reason ? `Reason: ${resultSummary.reason}` : "Final scores"}
                    </div>
                    <div
                      className={cn(
                        "mx-auto mt-3 inline-flex border px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] sm:mt-4",
                        typeof resultSummary.ratingDelta !== "number"
                          ? "border-zinc-800 bg-black/70 text-zinc-500"
                          : resultSummary.ratingDelta > 0
                            ? "border-emerald-400/45 bg-emerald-950/35 text-emerald-300"
                            : resultSummary.ratingDelta < 0
                              ? "border-red-400/45 bg-red-950/35 text-red-300"
                              : "border-zinc-700 bg-zinc-900 text-zinc-300",
                      )}
                    >
                      Rating{" "}
                      {typeof resultSummary.ratingDelta === "number"
                        ? `${resultSummary.ratingDelta > 0 ? "+" : ""}${Math.round(
                            resultSummary.ratingDelta,
                          )}`
                        : "syncing"}
                    </div>

                    <div className="mt-4 grid gap-2 sm:mt-6 sm:gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                      <div className="border border-zinc-800 bg-black/70 p-3 sm:p-4">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                          {resultSummary.myNickname ?? "You"}
                        </div>
                        <div className="mt-1 text-xl font-black tabular-nums text-zinc-100 sm:mt-2 sm:text-2xl">
                          {formatScoreOutOfTen(resultSummary.myFinal)}
                        </div>
                      </div>
                      <div className="text-base font-black uppercase tracking-[0.16em] text-purple-200 sm:text-lg">
                        VS
                      </div>
                      <div className="border border-zinc-800 bg-black/70 p-3 sm:p-4">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                          {resultSummary.oppNickname ?? "Opponent"}
                        </div>
                        <div className="mt-1 text-xl font-black tabular-nums text-zinc-100 sm:mt-2 sm:text-2xl">
                          {formatScoreOutOfTen(resultSummary.oppFinal)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2 sm:mt-6 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={resetMatchFlow}
                        className="inline-flex h-10 items-center justify-center border border-purple-500/50 bg-purple-950/35 px-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-purple-100 transition-colors hover:border-purple-300 hover:text-white sm:h-11"
                      >
                        Find Another Match
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          stopResultSound();
                          onClose();
                        }}
                        className="inline-flex h-10 items-center justify-center border border-zinc-800 bg-black/70 px-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 sm:h-11"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

