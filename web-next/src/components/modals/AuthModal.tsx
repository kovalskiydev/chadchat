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

export function AuthModal({
  mode,
  setMode,
  nickname,
  password,
  onNickname,
  onPassword,
  onSubmit,
  onClose,
  isAnonymous,
  isSubmitting,
  error,
  verificationToken,
  consentAccepted,
  onConsentChange,
  onOpenRules,
  onOpenPrivacy,
}: {
  mode: "login" | "register";
  setMode: (mode: "login" | "register") => void;
  nickname: string;
  password: string;
  onNickname: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  isAnonymous: boolean;
  isSubmitting: boolean;
  error: string | null;
  verificationToken: string | null;
  consentAccepted: boolean;
  onConsentChange: (checked: boolean) => void;
  onOpenRules: () => void;
  onOpenPrivacy: () => void;
}) {
  const actionLabel =
    mode === "login" ? "Login" : isAnonymous ? "Upgrade Profile" : "Register";
  const requiresConsent = mode !== "login";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      onMouseDown={onClose}
    >
      <div
        className="h-screen w-full overflow-y-auto border-x-0 border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)] sm:h-auto sm:max-w-md sm:rounded-none sm:border"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2
            className="text-base font-black uppercase tracking-[0.14em] text-zinc-100"
            id="auth-modal-title"
          >
            Profile Auth
          </h2>
          <button
            className="inline-flex h-10 w-10 items-center justify-center border border-zinc-800 bg-black/80 text-zinc-400 transition-colors hover:border-purple-400 hover:text-white"
            onClick={onClose}
            type="button"
            aria-label="Close auth"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 border border-zinc-900 bg-black/60 p-1">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={cn(
                "h-9 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 transition-colors hover:text-zinc-100",
                mode === "login" && "bg-purple-950/55 text-purple-100",
              )}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={cn(
                "h-9 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 transition-colors hover:text-zinc-100",
                mode === "register" && "bg-purple-950/55 text-purple-100",
              )}
            >
              Register
            </button>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">
              Nickname
            </label>
            <input
              value={nickname}
              onChange={(event) => onNickname(event.target.value)}
              className="h-10 w-full border border-zinc-800 bg-black/80 px-3 text-xs text-zinc-100 outline-none transition-colors focus:border-purple-400"
              placeholder="volatileMS"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(event) => onPassword(event.target.value)}
              className="h-10 w-full border border-zinc-800 bg-black/80 px-3 text-xs text-zinc-100 outline-none transition-colors focus:border-purple-400"
              placeholder="********"
            />
          </div>
          {error && (
            <div className="border border-red-500/45 bg-red-950/35 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-200">
              {error}
            </div>
          )}
          {requiresConsent && (
            <label className="grid cursor-pointer grid-cols-[16px_1fr] items-start gap-3 border border-zinc-800 bg-black/60 px-3 py-3">
              <input
                type="checkbox"
                checked={consentAccepted}
                onChange={(event) => onConsentChange(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded-none border border-zinc-600 bg-black accent-purple-400"
              />
              <span className="text-[10px] leading-5 text-zinc-400">
                I agree to the{" "}
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onOpenRules();
                  }}
                  className="text-zinc-200 underline underline-offset-2 hover:text-white"
                >
                  rules
                </button>
                {" "}and{" "}
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onOpenPrivacy();
                  }}
                  className="text-zinc-200 underline underline-offset-2 hover:text-white"
                >
                  privacy policy
                </button>
                , confirm that I am 18+, and consent to the processing of my personal data.
              </span>
            </label>
          )}
          <button
            type="button"
            onClick={onSubmit}
            disabled={isSubmitting || (requiresConsent && !consentAccepted)}
            className="inline-flex h-10 w-full items-center justify-center border border-purple-500/50 bg-purple-950/35 text-[10px] font-semibold uppercase tracking-[0.14em] text-purple-100 transition-colors hover:border-purple-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Please Wait..." : actionLabel}
          </button>
          {mode === "register" && (
            <div className="space-y-2">
              {!isAnonymous && (
                <div
                  className={cn(
                    "border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em]",
                    verificationToken
                      ? "border-emerald-500/45 bg-emerald-950/35 text-emerald-200"
                      : "border-zinc-800 bg-black/60 text-zinc-500",
                  )}
                >
                  {verificationToken
                    ? "Verification passed. Registration will continue."
                    : "Verification starts automatically after submit."}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

