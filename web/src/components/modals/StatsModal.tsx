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

export function StatsModal({
  onClose,
  stats,
  periodApiData,
  recentForm,
  queueInfo,
}: {
  onClose: () => void;
  stats: StatsSnapshot;
  periodApiData: Partial<Record<StatsPeriodKey, StatsPeriod>>;
  recentForm: string[];
  queueInfo: QueueInfo | null;
}) {
  const [period, setPeriod] = useState<StatsPeriodKey>("today");
  const periodStatsMap = buildPeriodStats(stats, periodApiData);
  const periodStats = periodStatsMap[period];
  const hasPeriodStats = Boolean(periodStats);
  const progress = Math.max(0, Math.min(100, stats.progressPercent));
  const remaining = Math.max(
    0,
    stats.nextRankRating - (periodStats?.rating ?? stats.rating),
  );
  const metrics = [
    { label: "Peak Rating", value: periodStats?.peakRating, trend: periodStats?.peakTrend },
    { label: "Matches", value: periodStats?.matches, trend: periodStats?.matchesTrend },
    { label: "Wins", value: periodStats?.wins, trend: periodStats?.winsTrend },
    { label: "Losses", value: periodStats?.losses, trend: periodStats?.lossesTrend },
    {
      label: "Win Rate",
      value: typeof periodStats?.winRate === "number" ? `${periodStats.winRate}%` : undefined,
      trend: periodStats?.winRateTrend,
    },
    {
      label: "Average Score",
      value: periodStats?.averageScore,
      trend: periodStats?.averageScoreTrend,
    },
    {
      label: "Avg Gain",
      value: typeof periodStats?.avgGain === "number" ? `+${periodStats.avgGain}` : undefined,
      trend: periodStats?.avgGainTrend,
    },
    {
      label: "Avg Loss",
      value: typeof periodStats?.avgLoss === "number" ? `-${periodStats.avgLoss}` : undefined,
      trend: periodStats?.avgLossTrend,
    },
  ];
  const getTrendClass = (trend?: number) => {
    if (typeof trend !== "number") return "border-zinc-800 bg-zinc-950 text-zinc-600";
    if (trend > 0) return "border-emerald-400/45 bg-emerald-950/40 text-emerald-300";
    if (trend < 0) return "border-red-400/45 bg-red-950/40 text-red-300";
    return "border-zinc-700 bg-zinc-900 text-zinc-400";
  };
  const getTrendLabel = (trend?: number) => {
    if (typeof trend !== "number") return "no data";
    if (trend > 0) return "up";
    if (trend < 0) return "down";
    return "flat";
  };
  const formatTrend = (trend?: number) => {
    if (typeof trend !== "number") return "--";
    if (trend > 0) return `+${trend}`;
    return String(trend);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stats-modal-title"
      onMouseDown={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-3xl overflow-y-auto border border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
              Player Report
            </div>
            <h2
              className="mt-2 text-lg font-black uppercase tracking-[0.14em] text-zinc-100"
              id="stats-modal-title"
            >
              Detailed Statistics
            </h2>
          </div>
          <button
            className="inline-flex h-10 w-10 items-center justify-center border border-zinc-800 bg-black/80 text-zinc-400 transition-colors hover:border-purple-400 hover:text-white"
            onClick={onClose}
            type="button"
            aria-label="Close statistics"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="grid gap-4 p-5 lg:grid-cols-[1fr_220px]">
          <div className="space-y-4">
            <div className="grid grid-cols-3 border border-zinc-900 bg-black/60 p-1">
              {(Object.keys(statsByPeriod) as StatsPeriodKey[]).map((key) => (
                <button
                  className={cn(
                    "h-9 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 transition-colors hover:text-zinc-100",
                    period === key && "bg-purple-950/55 text-purple-100",
                  )}
                  key={key}
                  onClick={() => setPeriod(key)}
                  type="button"
                >
                  {statsByPeriod[key].label}
                </button>
              ))}
            </div>

            <div className="border border-zinc-900 bg-black/60 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span
                  className={cn(
                    "border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]",
                    getRankClass(stats.rank),
                  )}
                >
                  {stats.rank}
                </span>
                <span className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                  Next: {stats.nextRank}
                </span>
              </div>
              <div className="text-5xl font-black tabular-nums text-zinc-100">
                {periodStats?.rating ?? stats.rating}
              </div>
              {!hasPeriodStats && (
                <div className="mt-2 border border-zinc-900 bg-black/50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  Period data did not load
                </div>
              )}
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                  <span>Rank Progress</span>
                  <span className="text-purple-200">{progress}%</span>
                </div>
                <div className="h-2 overflow-hidden bg-zinc-900">
                  <div
                    className="h-full bg-purple-400 shadow-[0_0_14px_rgba(168,85,247,0.9)]"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="mt-2 text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                  {remaining} rating left to {stats.nextRank}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric) => (
                <div
                  className="min-w-0 border border-zinc-900 bg-black/60 p-3"
                  key={metric.label}
                >
                  <div className="truncate text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                    {metric.label}
                  </div>
                  <div className="mt-2 text-xl font-black tabular-nums text-zinc-100">
                    {metric.value ?? "--"}
                  </div>
                  <div
                    className={cn(
                      "mt-3 inline-flex border px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em]",
                      getTrendClass(metric.trend),
                    )}
                  >
                    <span className="tabular-nums">
                      {formatTrend(metric.trend)}
                    </span>
                    <span className="ml-1 opacity-75">
                      {getTrendLabel(metric.trend)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {[
              ["Recent Form", recentForm.length ? recentForm.join(" ") : "N/A"],
              ["Best Streak", `+${stats.streak}`],
              ["Queue", queueInfo?.queue_type ?? "Ranked"],
              [
                "Last Match",
                typeof queueInfo?.last_match_rating_delta === "number"
                  ? `${queueInfo.last_match_rating_delta > 0 ? "+" : ""}${Math.round(
                      queueInfo.last_match_rating_delta,
                    )} rating`
                  : "N/A",
              ],
            ].map(([label, value]) => (
              <div className="border border-zinc-900 bg-black/60 p-3" key={label}>
                <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                  {label}
                </div>
                <div className="mt-2 text-sm font-black uppercase tracking-[0.08em] text-zinc-100">
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

