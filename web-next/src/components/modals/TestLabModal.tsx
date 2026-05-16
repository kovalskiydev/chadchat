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

export function TestLabModal({
  accessToken,
  onClose,
}: {
  accessToken: string | null;
  onClose: (completed: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [room, setRoom] = useState<TestLabRoom | null>(null);
  const [loadingRoom, setLoadingRoom] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"waiting_camera" | "countdown" | "scanning" | "result">(
    "waiting_camera",
  );
  const [cameraDenied, setCameraDenied] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [runKey, setRunKey] = useState(0);
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [bestScore, setBestScore] = useState<number | null>(null);
  const [averageScore, setAverageScore] = useState<number | null>(null); // final
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const completedRef = useRef(false);
  const canClose = phase === "result";

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      if (!accessToken) return;
      setLoadingRoom(true);
      setError(null);
      try {
        const created = await createTestLabRoom(accessToken);
        if (!mounted) return;
        setRoom(created);
        const roomID = getRoomID(created);
        if (roomID) {
          const fresh = await getTestLabRoom(accessToken, roomID);
          if (!mounted) return;
          setRoom(fresh);
        }
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : "Failed to create room");
      } finally {
        if (mounted) setLoadingRoom(false);
      }
    };
    void init();
    return () => {
      mounted = false;
    };
  }, [accessToken]);

  useEffect(() => {
    let mounted = true;
    const startCamera = async () => {
      try {
        setCameraDenied(false);
        setCameraReady(false);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (!mounted) return;
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch {
        if (mounted) {
          setCameraDenied(true);
          setCameraReady(false);
          setError("Allow camera access to run Test Lab");
        }
      }
    };
    if (phase !== "result") {
      void startCamera();
    }
    return () => {
      mounted = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCameraReady(false);
    };
  }, [phase, runKey]);

  useEffect(() => {
    let mounted = true;
    let rafId = 0;
    let lastVideoTime = -1;
    let faceLandmarker: ChadFaceLandmarker | null = null;

    const drawLoop = () => {
      if (!mounted) return;
      if (!videoRef.current || !overlayRef.current) {
        rafId = window.requestAnimationFrame(drawLoop);
        return;
      }
      const video = videoRef.current;
      const canvas = overlayRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) {
        rafId = window.requestAnimationFrame(drawLoop);
        return;
      }

      const w = video.videoWidth || 640;
      const h = video.videoHeight || 360;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(168,85,247,0.08)";
      const t = (performance.now() / 8) % h;
      ctx.fillRect(0, t, w, 2);
      ctx.strokeStyle = "rgba(192,132,252,0.9)";
      ctx.lineWidth = 3;
      ctx.strokeRect(10, 10, w - 20, h - 20);
      ctx.strokeStyle = "rgba(168,85,247,0.35)";
      ctx.lineWidth = 1;
      ctx.strokeRect(14, 14, w - 28, h - 28);

      if (
        faceLandmarker &&
        video.readyState >= 2 &&
        video.currentTime !== lastVideoTime
      ) {
        lastVideoTime = video.currentTime;
        const result = faceLandmarker.detectForVideo(video, performance.now());
        const landmarks = result.faceLandmarks?.[0];
        if (landmarks) {
          ctx.fillStyle = "rgba(255,255,255,0.34)";
          for (let i = 0; i < landmarks.length; i += 2) {
            const p = landmarks[i];
            ctx.fillRect(p.x * w - 0.75, p.y * h - 0.75, 1.5, 1.5);
          }

          const keyIndices = [1, 10, 152, 33, 133, 362, 263, 61, 291, 234, 454];
          ctx.fillStyle = "rgba(192,132,252,0.95)";
          for (const idx of keyIndices) {
            const p = landmarks[idx];
            if (!p) continue;
            ctx.beginPath();
            ctx.arc(p.x * w, p.y * h, 3.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      rafId = window.requestAnimationFrame(drawLoop);
    };

    const init = async () => {
      try {
        faceLandmarker = await getFaceLandmarker();
      } catch {
        // keep decorative scan overlay only if model fails
      } finally {
        drawLoop();
      }
    };

    void init();
    return () => {
      mounted = false;
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  const captureFrameBase64 = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 360;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    return dataUrl.split(",")[1] ?? null;
  }, []);

  const captureAndScan = useCallback(async (activeSessionID: string): Promise<boolean> => {
    if (!accessToken) {
      setError("Login required");
      return false;
    }
    const roomID = getRoomID(room);
    if (!roomID) {
      setError("Room is not ready");
      return false;
    }
    const imageBase64 = captureFrameBase64();
    if (!imageBase64) {
      setError("Camera frame not ready");
      return false;
    }
    setError(null);
    let result;
    try {
      result = await scanTestLabSession(
        accessToken,
        roomID,
        activeSessionID,
        imageBase64,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Session scan failed");
      return false;
    }
    if (typeof result.last_score === "number") {
      setLastScore(result.last_score);
      setBestScore((current) =>
        current === null ? result.last_score ?? null : Math.max(current, result.last_score ?? current),
      );
    }
    if (typeof result.final_average === "number") setAverageScore(result.final_average);
    if (typeof result.seconds_left === "number") setSecondsLeft(result.seconds_left);
    return result.is_finished === true;
  }, [accessToken, room, captureFrameBase64]);

  const startSessionAndScan = useCallback(async () => {
    if (!accessToken) {
      setError("Login required");
      return;
    }
    const roomID = getRoomID(room);
    if (!roomID) {
      setError("Room is not ready");
      return;
    }
    setScanning(true);
    setPhase("scanning");
    setError(null);
    setLastScore(null);
    setBestScore(null);
    setAverageScore(null);
    try {
      const started = await startTestLabSession(accessToken, roomID, 10);
      const sid = String(started.id ?? started.session_id ?? "");
      if (!sid) throw new Error("Session id missing");
      setSecondsLeft(
        typeof started.seconds_left === "number"
          ? started.seconds_left
          : 10,
      );

      let finished = false;
      while (!finished) {
        finished = await captureAndScan(sid);
        if (!finished) {
          await new Promise((resolve) => window.setTimeout(resolve, 300));
        }
      }

      const finalState = await getTestLabSession(accessToken, roomID, sid);
      if (typeof finalState.final_average === "number") {
        setAverageScore(finalState.final_average);
      } else if (typeof finalState.running_average === "number") {
        setAverageScore(finalState.running_average);
      }
      if (typeof finalState.seconds_left === "number") setSecondsLeft(finalState.seconds_left);
      completedRef.current = true;
      setPhase("result");
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Session scan failed");
      setPhase("waiting_camera");
    } finally {
      setScanning(false);
    }
  }, [accessToken, room, captureAndScan]);

  const roomID = getRoomID(room);
  const canStart = Boolean(
    accessToken &&
      roomID &&
      !loadingRoom &&
      !cameraDenied &&
      cameraReady,
  );

  useEffect(() => {
    if (phase !== "waiting_camera" || !canStart || scanning) return;
    setCountdown(3);
    setPhase("countdown");
  }, [phase, canStart, scanning]);

  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 1) {
      void startSessionAndScan();
      return;
    }
    const timer = window.setTimeout(() => {
      setCountdown((current) => current - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [phase, countdown, startSessionAndScan]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="test-lab-title"
      onMouseDown={() => {
        if (canClose) onClose(completedRef.current);
      }}
    >
      <div
        className="h-screen w-full overflow-y-auto border-x-0 border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)] sm:h-auto sm:max-w-6xl sm:rounded-none sm:border"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
              Test Lab
            </div>
            <h2
              className="mt-2 text-lg font-black uppercase tracking-[0.14em] text-zinc-100"
              id="test-lab-title"
            >
              Camera Evaluation
            </h2>
          </div>
          <button
            className={cn(
              "inline-flex h-10 w-10 items-center justify-center border bg-black/80 transition-colors",
              canClose
                ? "border-zinc-800 text-zinc-400 hover:border-purple-400 hover:text-white"
                : "cursor-not-allowed border-zinc-900 text-zinc-700",
            )}
            onClick={() => {
              if (canClose) onClose(completedRef.current);
            }}
            type="button"
            aria-label="Close test lab"
            disabled={!canClose}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="grid gap-3 p-3 sm:gap-4 sm:p-5 lg:grid-cols-[1.7fr_1fr]">
          {phase === "result" ? (
            <div className="flex min-h-48 items-center justify-center border border-zinc-800 bg-black/80 p-4 text-center sm:min-h-72 sm:p-6">
              <div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                  Scan Complete
                </div>
                <div className="mt-3 text-3xl font-black tabular-nums text-zinc-100">
                  {formatScoreOutOfTen(averageScore)}
                </div>
                <div className="mt-2 text-xs uppercase tracking-[0.12em] text-zinc-500">
                  Final Average
                </div>
              </div>
            </div>
          ) : (
            <div className="relative overflow-hidden border border-zinc-800 bg-black/80">
              <video
                ref={videoRef}
                className="h-full min-h-[280px] w-full object-cover sm:min-h-[400px] lg:min-h-[520px]"
                muted
                playsInline
              />
              <canvas
                ref={overlayRef}
                className="pointer-events-none absolute inset-0 z-10 h-full w-full object-cover"
              />
              {phase === "scanning" && (
                <div className="absolute left-4 top-4 z-20 border border-purple-400/60 bg-black/60 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Current
                  </div>
                  <div className="mt-1 text-xl font-black tabular-nums text-purple-100">
                    {formatScoreOutOfTen(lastScore)}
                  </div>
                </div>
              )}
              {phase === "countdown" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                  <div className="text-4xl font-black tabular-nums text-white sm:text-6xl">{countdown}</div>
                </div>
              )}
              {phase === "waiting_camera" && !cameraDenied && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                  <div className="border border-zinc-700 bg-black/65 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-300">
                    Preparing Camera...
                  </div>
                </div>
              )}
              {cameraDenied && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/55 p-4 text-center">
                  <div className="border border-red-500/45 bg-red-950/35 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-red-200">
                    Allow camera access to continue
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="space-y-2 sm:space-y-3">
            <div className="border border-zinc-800 bg-black/60 p-2.5 text-[10px] uppercase tracking-[0.12em] text-zinc-500 sm:p-3">
              Room: {roomID || (loadingRoom ? "Creating..." : "-")}
            </div>
            {phase === "result" ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="border border-zinc-800 bg-black/60 p-2.5 sm:p-3">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Best</div>
                  <div className="mt-1 text-base font-black tabular-nums text-zinc-100 sm:text-lg">
                    {formatScoreOutOfTen(bestScore)}
                  </div>
                </div>
                <div className="border border-zinc-800 bg-black/60 p-2.5 sm:p-3">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Average</div>
                  <div className="mt-1 text-base font-black tabular-nums text-zinc-100 sm:text-lg">
                    {formatScoreOutOfTen(averageScore)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="border border-zinc-800 bg-black/60 p-2.5 text-[10px] uppercase tracking-[0.12em] text-zinc-400 sm:p-3">
                {phase === "waiting_camera" && "Waiting for camera permission"}
                {phase === "countdown" && "Get ready"}
                {phase === "scanning" && "Scanning in progress"}
              </div>
            )}
            <div className="border border-zinc-800 bg-black/60 p-2.5 sm:p-3">
              <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                <span>Scan Progress</span>
                <span className="text-purple-200">{secondsLeft}s</span>
              </div>
              <div className="h-2 overflow-hidden bg-zinc-900">
                <div
                  className="h-full bg-purple-400 shadow-[0_0_14px_rgba(168,85,247,0.8)] transition-all duration-300 ease-out"
                  style={{ width: `${Math.max(0, Math.min(100, ((10 - secondsLeft) / 10) * 100))}%` }}
                />
              </div>
            </div>
            {error && (
              <div className="border border-red-500/45 bg-red-950/35 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-200">
                {error}
              </div>
            )}
            {phase === "result" && (
              <button
                type="button"
                onClick={() => {
                  completedRef.current = false;
                  setRunKey((current) => current + 1);
                  setSecondsLeft(0);
                  setPhase("waiting_camera");
                  setCameraReady(false);
                  setError(null);
                }}
                className="inline-flex h-10 w-full items-center justify-center gap-2 border border-purple-500/50 bg-purple-950/35 text-[10px] font-semibold uppercase tracking-[0.14em] text-purple-100 transition-colors hover:border-purple-300 hover:text-white"
              >
                <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                Repeat
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

