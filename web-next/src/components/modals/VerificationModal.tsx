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

export function VerificationModal({
  session,
  detected,
  setDetected,
  onSubmit,
  onClose,
  isSubmitting,
  error,
}: {
  session: VerificationStartResponse;
  detected: { blink: number; left: number; right: number };
  setDetected: React.Dispatch<
    React.SetStateAction<{ blink: number; left: number; right: number }>
  >;
  onSubmit: () => void;
  onClose: () => void;
  isSubmitting: boolean;
  error: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const done =
    detected.blink >= session.blink_count &&
    detected.left >= session.turn_left &&
    detected.right >= session.turn_right;
  const totalRequired = session.blink_count + session.turn_left + session.turn_right;
  const totalDone =
    Math.min(detected.blink, session.blink_count) +
    Math.min(detected.left, session.turn_left) +
    Math.min(detected.right, session.turn_right);
  const progressPct = totalRequired > 0 ? Math.round((totalDone / totalRequired) * 100) : 0;
  const currentStep =
    detected.blink < session.blink_count
      ? "blink"
      : detected.left < session.turn_left
        ? "left"
        : detected.right < session.turn_right
          ? "right"
          : "done";
  const [timeLeft, setTimeLeft] = useState(session.expires_in_sec);
  const [cameraState, setCameraState] = useState<"loading" | "ready" | "error">("loading");
  const [trackerState, setTrackerState] = useState<"loading" | "ready" | "error">("loading");
  const [trackerRetryKey, setTrackerRetryKey] = useState(0);
  const autoSubmittedRef = useRef(false);

  useEffect(() => {
    setTimeLeft(session.expires_in_sec);
  }, [session.expires_in_sec, session.verification_session_id]);

  useEffect(() => {
    setCameraState("loading");
    setTrackerState("loading");
  }, [session.verification_session_id]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTimeLeft((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!done || timeLeft <= 0 || isSubmitting || autoSubmittedRef.current) return;
    autoSubmittedRef.current = true;
    onSubmit();
  }, [done, timeLeft, isSubmitting, onSubmit]);

  useEffect(() => {
    let mounted = true;
    let rafId = 0;
    let lastVideoTime = -1;
    let faceLandmarker: ChadFaceLandmarker | null = null;
    let blinkArmed = true;
    let lastBlinkTs = 0;
    let leftArmed = true;
    let rightArmed = true;

    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);

    const eyeAspectRatio = (
      points: Array<{ x: number; y: number }>,
      indices: [number, number, number, number, number, number],
    ) => {
      const [p1, p2, p3, p4, p5, p6] = indices.map((i) => points[i]);
      if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return 0;
      const a = dist(p2, p6);
      const b = dist(p3, p5);
      const c = dist(p1, p4) || 1e-6;
      return (a + b) / (2 * c);
    };

    const yawFromMatrix = (
      matrixObj?: { data?: number[] } | number[],
    ): number | null => {
      if (!matrixObj) return null;
      const raw = Array.isArray(matrixObj) ? matrixObj : matrixObj.data;
      if (!raw || raw.length < 16) return null;
      const m00 = raw[0];
      const m10 = raw[4];
      const m20 = raw[8];
      const pitch = Math.asin(Math.max(-1, Math.min(1, -m20)));
      void pitch;
      const yaw = Math.atan2(m10, m00);
      return (yaw * 180) / Math.PI;
    };

    const detectLoop = () => {
      if (!mounted || !videoRef.current || !faceLandmarker) return;
      const video = videoRef.current;
      const canvas = overlayRef.current;
      const ctx = canvas?.getContext("2d");
      if (video.readyState < 2) {
        rafId = window.requestAnimationFrame(detectLoop);
        return;
      }

      if (canvas && ctx) {
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
      }

      if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const result = faceLandmarker.detectForVideo(video, performance.now());
        const landmarks = result.faceLandmarks?.[0];
        if (landmarks) {
          if (canvas && ctx) {
            const w = canvas.width;
            const h = canvas.height;
            ctx.strokeStyle = "rgba(192,132,252,0.9)";
            ctx.lineWidth = 3;
            ctx.strokeRect(10, 10, w - 20, h - 20);
            ctx.strokeStyle = "rgba(168,85,247,0.35)";
            ctx.lineWidth = 1;
            ctx.strokeRect(14, 14, w - 28, h - 28);
            // Face mesh: soft white translucent micro-grid
            ctx.fillStyle = "rgba(255,255,255,0.34)";
            for (let i = 0; i < landmarks.length; i += 2) {
              const p = landmarks[i];
              ctx.fillRect(p.x * w - 0.75, p.y * h - 0.75, 1.5, 1.5);
            }

            // Main feature anchors: larger purple points
            const keyIndices = [
              1, // nose tip
              10, 152, // forehead/chin
              33, 133, 362, 263, // eye corners
              61, 291, // mouth corners
              234, 454, // cheeks
            ];
            ctx.fillStyle = "rgba(192,132,252,0.95)";
            for (const idx of keyIndices) {
              const p = landmarks[idx];
              if (!p) continue;
              const x = p.x * w;
              const y = p.y * h;
              ctx.beginPath();
              ctx.arc(x, y, 3.2, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          const leftEAR = eyeAspectRatio(landmarks, [33, 160, 158, 133, 153, 144]);
          const rightEAR = eyeAspectRatio(landmarks, [362, 385, 387, 263, 373, 380]);
          const ear = (leftEAR + rightEAR) / 2;
          const now = performance.now();

          if (ear > 0.24) blinkArmed = true;
          if (blinkArmed && ear < 0.19 && now - lastBlinkTs > 350) {
            blinkArmed = false;
            lastBlinkTs = now;
            setDetected((current) => ({
              ...current,
              blink: Math.min(session.blink_count, current.blink + 1),
            }));
          }

          const yaw = yawFromMatrix(result.facialTransformationMatrixes?.[0]);
          if (yaw !== null) {
            if (yaw > 12 && leftArmed) {
              leftArmed = false;
              rightArmed = true;
              setDetected((current) => ({
                ...current,
                left: Math.min(session.turn_left, current.left + 1),
              }));
            } else if (yaw < -12 && rightArmed) {
              rightArmed = false;
              leftArmed = true;
              setDetected((current) => ({
                ...current,
                right: Math.min(session.turn_right, current.right + 1),
              }));
            } else if (Math.abs(yaw) < 6) {
              leftArmed = true;
              rightArmed = true;
            }
          }
        }
      }
      rafId = window.requestAnimationFrame(detectLoop);
    };

    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: true,
        });
        if (!mounted) return;
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraState("ready");

        faceLandmarker = trackerRetryKey > 0
          ? await retryFaceLandmarker()
          : await getFaceLandmarker();

        setTrackerState("ready");
        detectLoop();
      } catch {
        if (!mounted) return;
        if (!streamRef.current) {
          setCameraState("error");
        }
        setTrackerState("error");
      }
    };
    void init();
    return () => {
      mounted = false;
      if (rafId) window.cancelAnimationFrame(rafId);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [session.blink_count, session.turn_left, session.turn_right, setDetected, trackerRetryKey]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="verification-title"
      onMouseDown={onClose}
    >
      <div
        className="h-screen w-full overflow-y-auto border-x-0 border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)] sm:h-auto sm:max-w-2xl sm:rounded-none sm:border"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2
            id="verification-title"
            className="text-base font-black uppercase tracking-[0.14em] text-zinc-100"
          >
            Webcam Verification
          </h2>
          <button
            className="inline-flex h-10 w-10 items-center justify-center border border-zinc-800 bg-black/80 text-zinc-400 transition-colors hover:border-purple-400 hover:text-white"
            onClick={onClose}
            type="button"
            aria-label="Close verification"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-[1.2fr_1fr]">
          <div className="relative overflow-hidden border border-zinc-800 bg-black/80">
            <video ref={videoRef} className="h-full min-h-64 w-full object-cover" muted playsInline />
            <canvas
              ref={overlayRef}
              className="pointer-events-none absolute inset-0 z-10 h-full w-full object-cover opacity-100"
            />
            {(cameraState !== "ready" || trackerState !== "ready") && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-4 text-center">
                <div className="border border-zinc-800 bg-zinc-950 px-4 py-3">
                  {cameraState === "loading" && (
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-300">
                      Opening camera...
                    </div>
                  )}
                  {cameraState === "ready" && trackerState === "loading" && (
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-300">
                      Preparing face engine...
                    </div>
                  )}
                  {cameraState === "error" && (
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-red-300">
                      Camera access failed
                    </div>
                  )}
                  {cameraState !== "error" && trackerState === "error" && (
                    <div className="space-y-3">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-red-300">
                        Face engine failed to load
                      </div>
                      <button
                        className="inline-flex h-8 items-center justify-center border border-red-400/45 bg-red-950/35 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-100 transition-colors hover:border-red-300 hover:text-white"
                        type="button"
                        onClick={() => {
                          setTrackerState("loading");
                          setTrackerRetryKey((current) => current + 1);
                        }}
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div className="border border-zinc-800 bg-black/60 p-3 text-[10px] uppercase tracking-[0.12em] text-zinc-500">
              Session: {session.verification_session_id.slice(0, 10)}...
              <br />
              Expires: {timeLeft}s
            </div>
            <div className="border border-zinc-800 bg-black/60 p-3">
              <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                <span>Verification Progress</span>
                <span className="text-purple-200">{progressPct}%</span>
              </div>
              <div className="h-2 overflow-hidden bg-zinc-900">
                <div
                  className="h-full bg-purple-400 shadow-[0_0_14px_rgba(168,85,247,0.8)] transition-all duration-500 ease-out"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
            <div className="grid gap-2">
              {trackerState === "error" && (
                <div className="border border-red-500/45 bg-red-950/35 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-200">
                  Verification cannot continue until the face engine loads. Check your connection and retry.
                </div>
              )}
              <div
                className={cn(
                  "border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em]",
                  currentStep === "blink"
                    ? "border-purple-400 bg-purple-950/30 text-purple-100"
                    : detected.blink >= session.blink_count
                      ? "border-emerald-500/45 bg-emerald-950/25 text-emerald-200"
                      : "border-zinc-700 bg-zinc-900/60 text-zinc-200",
                )}
              >
                Step 1: Blink {session.blink_count} time(s) [{detected.blink}/{session.blink_count}]
              </div>
              <div
                className={cn(
                  "border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em]",
                  currentStep === "left"
                    ? "border-purple-400 bg-purple-950/30 text-purple-100"
                    : detected.left >= session.turn_left
                      ? "border-emerald-500/45 bg-emerald-950/25 text-emerald-200"
                      : "border-zinc-700 bg-zinc-900/60 text-zinc-200",
                )}
              >
                Step 2: Turn Left {session.turn_left} time(s) [{detected.left}/{session.turn_left}]
              </div>
              <div
                className={cn(
                  "border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em]",
                  currentStep === "right"
                    ? "border-purple-400 bg-purple-950/30 text-purple-100"
                    : detected.right >= session.turn_right
                      ? "border-emerald-500/45 bg-emerald-950/25 text-emerald-200"
                      : "border-zinc-700 bg-zinc-900/60 text-zinc-200",
                )}
              >
                Step 3: Turn Right {session.turn_right} time(s) [{detected.right}/{session.turn_right}]
              </div>
            </div>
            {error && (
              <div className="border border-red-500/45 bg-red-950/35 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-200">
                {error}
              </div>
            )}
            <div className="border border-zinc-800 bg-black/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              {isSubmitting
                ? "Submitting verification..."
                : done
                  ? "All steps done. Sending verification automatically..."
                  : "Complete all steps to auto-submit verification"}
            </div>
            {timeLeft <= 0 && (
              <div className="border border-red-500/45 bg-red-950/35 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-200">
                Verification session expired. Start a new verification.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

