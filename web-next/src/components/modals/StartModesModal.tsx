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

export function StartModesModal({
  onClose,
  onOpenTestLab,
  onOpenDuel,
}: {
  onClose: () => void;
  onOpenTestLab: () => void;
  onOpenDuel: () => void;
}) {
  const [searchingMode, setSearchingMode] = useState<string | null>(null);
  const [searchSeconds, setSearchSeconds] = useState(0);

  useEffect(() => {
    if (!searchingMode) return;

    const timer = window.setInterval(() => {
      setSearchSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [searchingMode]);

  const modes = [
    {
      id: "1v1",
      title: "1v1 Mogging",
      description:
        "Two players face off and mog each other. The one with the higher score wins the match.",
      icon: Signal,
    },
    {
      id: "arena",
      title: "Arena",
      description:
        "Other players watch and rate both participants to decide who takes the win.",
      icon: Trophy,
      disabled: true,
    },
    {
      id: "test-lab",
      title: "Test Lab",
      description:
        "Check your score, test your camera, find your best angle, and prepare before a real match.",
      icon: UserRoundCog,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/72 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="start-modes-title"
      onMouseDown={onClose}
    >
      <div
        className="h-screen w-full overflow-y-auto border-x-0 border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)] sm:h-auto sm:max-w-2xl sm:rounded-none sm:border"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
              Start Mogging
            </div>
            <h2
              className="mt-2 text-lg font-black uppercase tracking-[0.14em] text-zinc-100"
              id="start-modes-title"
            >
              Select Mode
            </h2>
          </div>
          <button
            className="inline-flex h-10 w-10 items-center justify-center border border-zinc-800 bg-black/80 text-zinc-400 transition-colors hover:border-purple-400 hover:text-white"
            onClick={onClose}
            type="button"
            aria-label="Close modes"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          {modes.map((mode) => {
            const Icon = mode.icon;
            const isActive = searchingMode === mode.id;
            const isInDevelopment = Boolean(mode.disabled);
            const isDisabled = isInDevelopment || (Boolean(searchingMode) && !isActive);
            return (
              <button
                key={mode.id}
                type="button"
                className={cn(
                  "min-h-48 border border-zinc-900 bg-black/60 p-4 text-left transition-colors hover:border-purple-400 hover:bg-purple-950/24 hover:shadow-[0_0_22px_rgba(132,0,255,0.18)]",
                  isActive && "border-purple-400 bg-purple-950/24",
                  isDisabled && "cursor-not-allowed opacity-45",
                )}
                disabled={isDisabled}
                onClick={() => {
                  if (isInDevelopment) return;
                  if (mode.id === "1v1") {
                    onOpenDuel();
                    onClose();
                    return;
                  }
                  if (mode.id === "test-lab") {
                    onOpenTestLab();
                    onClose();
                    return;
                  }
                  setSearchingMode(mode.id);
                  setSearchSeconds(0);
                }}
              >
                <div className="mb-6 flex items-center justify-between">
                  <Icon className="h-5 w-5 text-zinc-500" aria-hidden="true" />
                  <span
                    className={cn(
                      "h-2 w-2 bg-zinc-800",
                      isActive && "animate-pulse bg-purple-300",
                      isInDevelopment && "bg-amber-400/60",
                    )}
                  />
                </div>
                <div className="text-sm font-black uppercase tracking-[0.14em] text-zinc-100">
                  {mode.title}
                </div>
                <p className="mt-3 text-xs leading-5 text-zinc-500">
                  {mode.description}
                </p>
                {isInDevelopment && (
                  <div className="mt-4 inline-flex border border-amber-400/35 bg-amber-950/30 px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-amber-200">
                    In Development
                  </div>
                )}
              </button>
            );
          })}
        </div>
        {searchingMode && (
          <div className="border-t border-border px-5 py-3">
            <div className="grid gap-3 text-[10px] font-semibold uppercase tracking-[0.14em]">
              <div className="grid gap-2 border border-purple-500/35 bg-purple-950/18 p-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <div className="text-zinc-500">MM In Progress</div>
                  <div className="text-zinc-200">
                    Mode:{" "}
                    <span className="text-purple-200">
                      {modes.find((mode) => mode.id === searchingMode)?.title}
                    </span>
                  </div>
                  <div className="text-zinc-500">Region: Auto (Asia)</div>
                </div>
                <div className="space-y-1 sm:text-right">
                  <div className="text-zinc-500">
                    Elapsed:{" "}
                    <span className="text-zinc-200">
                      {String(searchSeconds).padStart(2, "0")}s
                    </span>
                  </div>
                  <div className="text-zinc-500">Queue: Competitive</div>
                  <div className="text-zinc-500">Est. Wait: 00:20 - 01:10</div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500">
                  Searching for opponent and syncing lobby
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSearchingMode(null);
                    setSearchSeconds(0);
                  }}
                  className="border border-red-500/65 bg-red-950/45 px-3 py-1 text-red-200 transition-colors hover:border-red-400 hover:bg-red-900/55 hover:text-red-100"
                >
                  CANCEL MATCH
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

