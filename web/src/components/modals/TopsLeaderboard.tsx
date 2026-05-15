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

export function TopsLeaderboard({
  entries,
  loading,
  onOpenProfile,
  avatarByUserId,
}: {
  entries: LeaderboardEntry[];
  loading: boolean;
  onOpenProfile: (userID: string) => void;
  avatarByUserId: Record<string, string | null>;
}) {
  const [page, setPage] = useState(0);
  const sortedPlayers = [...entries].sort((a, b) => b.rating - a.rating);
  const pageCount = Math.ceil(sortedPlayers.length / leaderboardPageSize);
  const pagePlayers = sortedPlayers.slice(
    page * leaderboardPageSize,
    page * leaderboardPageSize + leaderboardPageSize,
  );
  const canGoPrev = page > 0;
  const canGoNext = page < pageCount - 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4">
        {loading && (
          Array.from({ length: leaderboardPageSize }).map((_, index) => (
            <div
              className="grid grid-cols-[40px_1fr_auto] items-center gap-3 border border-zinc-900 bg-black/60 p-3"
              key={`leaderboard-skeleton-${index}`}
            >
              <div className="h-10 w-10 animate-pulse bg-zinc-900/80" />
              <div className="space-y-2">
                <div className="h-4 w-28 animate-pulse bg-zinc-900/80" />
                <div className="h-6 w-20 animate-pulse bg-zinc-900/80" />
              </div>
              <div className="space-y-2 justify-self-end text-right">
                <div className="h-4 w-14 animate-pulse bg-zinc-900/80" />
                <div className="h-3 w-10 animate-pulse bg-zinc-900/80" />
              </div>
            </div>
          ))
        )}
        {!loading && pagePlayers.length === 0 && (
          <div className="border border-zinc-800 bg-black/60 p-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
            No leaderboard data yet.
          </div>
        )}
        {pagePlayers.map((player, index) => {
          const position = page * leaderboardPageSize + index + 1;

          return (
            <div
              className={cn("relative overflow-hidden border p-3", getTopClass(position))}
              key={`${player.user_id}-${player.rating}`}
            >
              <span
                className={cn(
                  "absolute bottom-0 left-0 top-0 w-0.5",
                  getTopAccentClass(position),
                )}
              />
              <div className="grid grid-cols-[40px_1fr_auto] items-center gap-3">
                <PositionAvatar
                  position={position}
                  user={player.nickname}
                  avatarUrl={player.avatar_url ?? avatarByUserId[player.user_id] ?? undefined}
                  onClick={() => onOpenProfile(player.user_id)}
                />
                <div className="min-w-0">
                  {position <= 3 ? (
                    <GradientText
                      colors={getTopGradientColors(position)}
                      animationSpeed={8}
                      showBorder={false}
                      className="justify-start text-xs font-black uppercase tracking-[0.14em]"
                    >
                      <span className="truncate">{player.nickname}</span>
                    </GradientText>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenProfile(player.user_id)}
                      className="truncate text-left text-xs font-black uppercase tracking-[0.14em] text-zinc-200 transition-colors hover:text-purple-200"
                    >
                      {player.nickname}
                    </button>
                  )}
                  <div
                    className={cn(
                      "mt-2 inline-flex border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]",
                      getRankClass(formatRankLabel(player.rank)),
                    )}
                  >
                    {formatRankLabel(player.rank)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums text-zinc-100">
                    {player.rating}
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                    rating
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-[40px_1fr_40px] items-center gap-2 border-t border-border p-3">
        <button
          aria-label="Previous leaderboard page"
          className="inline-flex h-10 w-10 items-center justify-center border border-zinc-800 bg-black/80 text-zinc-400 transition-colors hover:border-purple-500 hover:text-purple-200 disabled:pointer-events-none disabled:opacity-30"
          disabled={!canGoPrev}
          onClick={() => setPage((current) => Math.max(0, current - 1))}
          type="button"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
          Page {page + 1} / {pageCount}
        </div>
        <button
          aria-label="Next leaderboard page"
          className="inline-flex h-10 w-10 items-center justify-center border border-zinc-800 bg-black/80 text-zinc-400 transition-colors hover:border-purple-500 hover:text-purple-200 disabled:pointer-events-none disabled:opacity-30"
          disabled={!canGoNext}
          onClick={() =>
            setPage((current) => Math.min(pageCount - 1, current + 1))
          }
          type="button"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

