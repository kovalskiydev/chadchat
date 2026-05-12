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
  Gem,
  Plus,
  CircleHelp,
  LogOut,
  User,
  Camera,
  Volume2,
  VolumeX,
} from "lucide-react";

import Crosshair from "@/components/Crosshair";
import GradientText from "@/components/GradientText";
import { GlobalSpotlight, ParticleCard } from "@/components/MagicBento";
import PixelBlast from "@/components/PixelBlast";
import Shuffle from "@/components/Shuffle";
import track1 from "@/track-1.m4a";
import track2 from "@/track-2.m4a";
import track3 from "@/track-3.m4a";
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
  getLiveChatHistory,
  sendLiveChatMessage,
  streamLiveChat,
  type LiveChatMessage,
} from "@/lib/liveChat";
import {
  duelCurrentMatch,
  duelGetMatch,
  duelMediaReady,
  duelQueueJoin,
  duelQueueLeave,
  duelScoreFrame,
  duelSignal,
  duelStream,
} from "@/lib/duel";
import { getApiHealth } from "@/lib/health";
import {
  getLeaderboard,
  getQueueInfo,
  getRecentForm,
  getMyRating,
  getStatsPeriod,
  getStatsSummary,
  type LeaderboardEntry,
  type RatingProfile,
  type QueueInfo,
  type StatsPeriod,
  type StatsSummary,
} from "@/lib/rating";
import {
  getResultSounds,
  selectResultSound,
  type ResultSoundOption,
} from "@/lib/resultSounds";

const magicBlockClass =
  "magic-bento-card magic-bento-wire magic-bento-card--border-glow";
const magicGlow = "132, 0, 255";
const duelQueueTracks = [track1, track2, track3];
const leaderboardPageSize = 6;
const auraBalance = 12840;
const currentStats = {
  rank: "HTN",
  nextRank: "CHADLITE",
  rating: 2149,
  rankFloor: 2000,
  nextRankRating: 2300,
  wins: 42,
  streak: 5,
  losses: 18,
  winRate: 70,
  peakRating: 2212,
  matches: 60,
  avgGain: 18,
  avgLoss: 11,
  averageScore: 86,
  ratingTrend: 37,
  peakTrend: 12,
  matchesTrend: 8,
  winsTrend: 4,
  lossesTrend: -1,
  winRateTrend: 3,
  averageScoreTrend: 6,
  avgGainTrend: 2,
  avgLossTrend: -2,
};
const statsByPeriod = {
  today: {
    label: "Today",
    rating: 2149,
    peakRating: 2162,
    matches: 7,
    wins: 5,
    losses: 2,
    winRate: 71,
    averageScore: 89,
    avgGain: 21,
    avgLoss: 9,
    ratingTrend: 37,
    peakTrend: 18,
    matchesTrend: 7,
    winsTrend: 5,
    lossesTrend: -2,
    winRateTrend: 8,
    averageScoreTrend: 6,
    avgGainTrend: 4,
    avgLossTrend: -2,
  },
  week: {
    label: "Week",
    rating: 2149,
    peakRating: 2212,
    matches: 34,
    wins: 24,
    losses: 10,
    winRate: 71,
    averageScore: 86,
    avgGain: 18,
    avgLoss: 11,
    ratingTrend: 112,
    peakTrend: 76,
    matchesTrend: 11,
    winsTrend: 6,
    lossesTrend: 1,
    winRateTrend: 3,
    averageScoreTrend: 4,
    avgGainTrend: 2,
    avgLossTrend: -1,
  },
  season: {
    label: "Season",
    rating: 2149,
    peakRating: 2212,
    matches: 60,
    wins: 42,
    losses: 18,
    winRate: 70,
    averageScore: 82,
    avgGain: 16,
    avgLoss: 12,
    ratingTrend: 384,
    peakTrend: 412,
    matchesTrend: 60,
    winsTrend: 42,
    lossesTrend: 18,
    winRateTrend: 12,
    averageScoreTrend: 9,
    avgGainTrend: 5,
    avgLossTrend: -3,
  },
};
type StatsPeriodKey = keyof typeof statsByPeriod;

type ChatMessage = {
  id: number | string;
  createdAt?: string;
  user: string;
  text: string;
  mine?: boolean;
  pending?: boolean;
};

type ChatCustomization = {
  title: string;
  nameColor: string;
  textStyle: string;
  titleBorderColor: string;
  titleBorderShape: string;
};

type GameCustomization = {
  frame: string;
  victorySound: string;
};

type DuelResultSound = {
  id: string;
  title: string;
  audio_url: string;
};

const defaultChatCustomization: ChatCustomization = {
  title: "RANKED",
  nameColor: "Purple",
  textStyle: "Sharp",
  titleBorderColor: "Purple",
  titleBorderShape: "Square",
};

const defaultGameCustomization: GameCustomization = {
  frame: "Neon Grid",
  victorySound: "Pulse",
};

const initialChatMessages: ChatMessage[] = [];

function getAvatarInitials(user: string) {
  return user
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 2)
    .toUpperCase();
}

function formatRankLabel(rank?: string | null) {
  const normalized = (rank ?? "").toLowerCase();
  switch (normalized) {
    case "subhuman":
      return "SUBHUMAN";
    case "subfive":
      return "SUB5";
    case "ltn":
      return "LTN";
    case "mtn":
      return "MTN";
    case "htn":
      return "HTN";
    case "chadlite":
      return "CHADLITE";
    case "chad":
      return "CHAD";
    case "trueadam":
      return "TRUE ADAM";
    default:
      return rank ? rank.toUpperCase() : "UNRANKED";
  }
}

function buildStatsSnapshot(
  ratingProfile: RatingProfile | null,
  statsSummary: StatsSummary | null,
) {
  const fallbackProgress = Math.round(
    ((currentStats.rating - currentStats.rankFloor) /
      (currentStats.nextRankRating - currentStats.rankFloor)) *
      100,
  );

  if (statsSummary) {
    return {
      ...currentStats,
      rank: formatRankLabel(statsSummary.rank),
      nextRank: formatRankLabel(statsSummary.next_rank),
      rating: statsSummary.rating,
      rankFloor: statsSummary.rank_floor ?? currentStats.rankFloor,
      nextRankRating: statsSummary.next_rank_rating ?? currentStats.nextRankRating,
      wins: statsSummary.wins,
      streak: statsSummary.streak,
      losses: statsSummary.losses,
      winRate: Math.round(statsSummary.win_rate),
      peakRating: statsSummary.peak_rating,
      matches: statsSummary.matches,
      avgGain: Math.round(statsSummary.avg_gain),
      avgLoss: Math.round(statsSummary.avg_loss),
      averageScore: Math.round(statsSummary.average_score),
      progressPercent: statsSummary.progress_percent ?? fallbackProgress,
    };
  }

  if (!ratingProfile) {
    return {
      ...currentStats,
      progressPercent: fallbackProgress,
    };
  }

  const rankFloor = ratingProfile.rank_floor ?? currentStats.rankFloor;
  const nextRankRating = ratingProfile.next_rank_rating ?? currentStats.nextRankRating;
  const progressPercent =
    ratingProfile.progress_percent ??
    Math.round(
      ((ratingProfile.rating - rankFloor) / Math.max(1, nextRankRating - rankFloor)) * 100,
    );

  return {
    ...currentStats,
    rank: formatRankLabel(ratingProfile.rank),
    nextRank: formatRankLabel(ratingProfile.next_rank),
    rating: ratingProfile.rating,
    rankFloor,
    nextRankRating,
    peakRating: ratingProfile.peak_rating,
    progressPercent,
  };
}

function buildPeriodStats(
  statsSnapshot: ReturnType<typeof buildStatsSnapshot>,
  periodApiData: Partial<Record<StatsPeriodKey, StatsPeriod>>,
) {
  const todayApi = periodApiData.today;
  const weekApi = periodApiData.week;
  const seasonApi = periodApiData.season;

  return {
    today: {
      ...statsByPeriod.today,
      rating: todayApi?.rating ?? statsSnapshot.rating,
      peakRating: todayApi?.peak_rating ?? statsSnapshot.peakRating,
      matches: todayApi?.matches ?? statsByPeriod.today.matches,
      wins: todayApi?.wins ?? statsByPeriod.today.wins,
      losses: todayApi?.losses ?? statsByPeriod.today.losses,
      winRate: Math.round(todayApi?.win_rate ?? statsByPeriod.today.winRate),
      averageScore: Math.round(todayApi?.average_score ?? statsByPeriod.today.averageScore),
      avgGain: Math.round(todayApi?.avg_gain ?? statsByPeriod.today.avgGain),
      avgLoss: Math.round(todayApi?.avg_loss ?? statsByPeriod.today.avgLoss),
      ratingTrend: Math.round(todayApi?.rating_trend ?? statsByPeriod.today.ratingTrend),
      peakTrend: Math.round(todayApi?.peak_trend ?? statsByPeriod.today.peakTrend),
      matchesTrend: Math.round(todayApi?.matches_trend ?? statsByPeriod.today.matchesTrend),
      winsTrend: Math.round(todayApi?.wins_trend ?? statsByPeriod.today.winsTrend),
      lossesTrend: Math.round(todayApi?.losses_trend ?? statsByPeriod.today.lossesTrend),
      winRateTrend: Math.round(todayApi?.win_rate_trend ?? statsByPeriod.today.winRateTrend),
      averageScoreTrend: Math.round(
        todayApi?.average_score_trend ?? statsByPeriod.today.averageScoreTrend,
      ),
      avgGainTrend: Math.round(todayApi?.avg_gain_trend ?? statsByPeriod.today.avgGainTrend),
      avgLossTrend: Math.round(todayApi?.avg_loss_trend ?? statsByPeriod.today.avgLossTrend),
    },
    week: {
      ...statsByPeriod.week,
      rating: weekApi?.rating ?? statsSnapshot.rating,
      peakRating: weekApi?.peak_rating ?? statsSnapshot.peakRating,
      matches: weekApi?.matches ?? statsByPeriod.week.matches,
      wins: weekApi?.wins ?? statsByPeriod.week.wins,
      losses: weekApi?.losses ?? statsByPeriod.week.losses,
      winRate: Math.round(weekApi?.win_rate ?? statsByPeriod.week.winRate),
      averageScore: Math.round(weekApi?.average_score ?? statsByPeriod.week.averageScore),
      avgGain: Math.round(weekApi?.avg_gain ?? statsByPeriod.week.avgGain),
      avgLoss: Math.round(weekApi?.avg_loss ?? statsByPeriod.week.avgLoss),
      ratingTrend: Math.round(weekApi?.rating_trend ?? statsByPeriod.week.ratingTrend),
      peakTrend: Math.round(weekApi?.peak_trend ?? statsByPeriod.week.peakTrend),
      matchesTrend: Math.round(weekApi?.matches_trend ?? statsByPeriod.week.matchesTrend),
      winsTrend: Math.round(weekApi?.wins_trend ?? statsByPeriod.week.winsTrend),
      lossesTrend: Math.round(weekApi?.losses_trend ?? statsByPeriod.week.lossesTrend),
      winRateTrend: Math.round(weekApi?.win_rate_trend ?? statsByPeriod.week.winRateTrend),
      averageScoreTrend: Math.round(
        weekApi?.average_score_trend ?? statsByPeriod.week.averageScoreTrend,
      ),
      avgGainTrend: Math.round(weekApi?.avg_gain_trend ?? statsByPeriod.week.avgGainTrend),
      avgLossTrend: Math.round(weekApi?.avg_loss_trend ?? statsByPeriod.week.avgLossTrend),
    },
    season: {
      ...statsByPeriod.season,
      rating: seasonApi?.rating ?? statsSnapshot.rating,
      peakRating: seasonApi?.peak_rating ?? statsSnapshot.peakRating,
      matches: seasonApi?.matches ?? statsByPeriod.season.matches,
      wins: seasonApi?.wins ?? statsByPeriod.season.wins,
      losses: seasonApi?.losses ?? statsByPeriod.season.losses,
      winRate: Math.round(seasonApi?.win_rate ?? statsByPeriod.season.winRate),
      averageScore: Math.round(seasonApi?.average_score ?? statsByPeriod.season.averageScore),
      avgGain: Math.round(seasonApi?.avg_gain ?? statsByPeriod.season.avgGain),
      avgLoss: Math.round(seasonApi?.avg_loss ?? statsByPeriod.season.avgLoss),
      ratingTrend: Math.round(seasonApi?.rating_trend ?? statsByPeriod.season.ratingTrend),
      peakTrend: Math.round(seasonApi?.peak_trend ?? statsByPeriod.season.peakTrend),
      matchesTrend: Math.round(seasonApi?.matches_trend ?? statsByPeriod.season.matchesTrend),
      winsTrend: Math.round(seasonApi?.wins_trend ?? statsByPeriod.season.winsTrend),
      lossesTrend: Math.round(seasonApi?.losses_trend ?? statsByPeriod.season.lossesTrend),
      winRateTrend: Math.round(seasonApi?.win_rate_trend ?? statsByPeriod.season.winRateTrend),
      averageScoreTrend: Math.round(
        seasonApi?.average_score_trend ?? statsByPeriod.season.averageScoreTrend,
      ),
      avgGainTrend: Math.round(seasonApi?.avg_gain_trend ?? statsByPeriod.season.avgGainTrend),
      avgLossTrend: Math.round(seasonApi?.avg_loss_trend ?? statsByPeriod.season.avgLossTrend),
    },
  };
}

function getAvatarClass(user: string) {
  const variants = [
    "from-purple-500/80 to-fuchsia-300/80",
    "from-sky-500/80 to-purple-300/80",
    "from-emerald-500/75 to-cyan-300/80",
    "from-zinc-500/80 to-purple-400/80",
    "from-yellow-500/80 to-fuchsia-300/75",
  ];
  const seed = user
    .split("")
    .reduce((total, char) => total + char.charCodeAt(0), 0);

  return variants[seed % variants.length];
}

function Avatar({
  user,
  className,
}: {
  user: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center border border-white/10 bg-gradient-to-br text-[10px] font-black uppercase tracking-[0.08em] text-white shadow-[0_0_16px_rgba(132,0,255,0.18)]",
        getAvatarClass(user),
        className,
      )}
    >
      {getAvatarInitials(user)}
    </div>
  );
}

function getNickColorClass(nameColor: string) {
  switch (nameColor) {
    case "Gold":
      return "bg-[#d4af37]";
    case "Silver":
      return "bg-[#c0c0c0]";
    case "Bronze":
      return "bg-[#cd7f32]";
    case "Neon":
      return "bg-gradient-to-r from-[#5227FF] via-[#FF9FFC] to-[#B497CF]";
    case "Inferno":
      return "bg-gradient-to-r from-red-500 via-orange-300 to-yellow-200";
    case "Ice":
      return "bg-gradient-to-r from-cyan-300 via-sky-400 to-violet-300";
    case "Toxic":
      return "bg-gradient-to-r from-lime-300 via-emerald-400 to-purple-400";
    default:
      return "bg-purple-400";
  }
}

function getChatTextClass(textStyle: string) {
  switch (textStyle) {
    case "Glitch":
      return "font-semibold tracking-[0.08em] text-purple-200";
    case "Minimal":
      return "tracking-0 text-zinc-400";
    case "Arcade":
      return "font-black uppercase tracking-[0.1em] text-zinc-200";
    default:
      return "text-zinc-300";
  }
}

function isAnimatedTitle(title: string) {
  return ["ELITE", "ASCENDED", "TRUE ADAM", "BLACKPILL", "VOIDKING"].includes(
    title,
  );
}

function getTitleBorderColorClass(color: string) {
  switch (color) {
    case "Gold":
      return "border-[#d4af37] text-[#f5d76e]";
    case "Silver":
      return "border-[#c0c0c0] text-[#e5e7eb]";
    case "Bronze":
      return "border-[#cd7f32] text-[#e3a05f]";
    case "Crimson":
      return "border-red-400 text-red-200";
    case "Cyan":
      return "border-cyan-300 text-cyan-200";
    default:
      return "border-purple-400/55 text-purple-200";
  }
}

function getTitleBorderShapeClass(shape: string) {
  switch (shape) {
    case "Rounded":
      return "rounded-sm";
    case "Pill":
      return "rounded-full px-3";
    case "Double":
      return "border-2 rounded-sm";
    case "Dashed":
      return "border-dashed rounded-sm";
    default:
      return "rounded-none";
  }
}

function getGameFrameClass(frame: string) {
  switch (frame) {
    case "Steel":
      return "border-zinc-400/70 bg-zinc-950/60 shadow-[0_0_16px_rgba(161,161,170,0.25)]";
    case "Gold":
      return "border-[#d4af37]/80 bg-[#d4af37]/10 shadow-[0_0_16px_rgba(212,175,55,0.22)]";
    case "Carbon":
      return "border-zinc-600 bg-black/80 shadow-[0_0_14px_rgba(39,39,42,0.4)]";
    case "Abyss":
      return "border-cyan-300/70 bg-cyan-950/30 shadow-[0_0_18px_rgba(103,232,249,0.2)]";
    default:
      return "border-purple-400/75 bg-purple-950/28 shadow-[0_0_18px_rgba(132,0,255,0.22)]";
  }
}

function normalizeDuelResultSound(value: unknown): DuelResultSound | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = record.id ? String(record.id) : "";
  const title = record.title ? String(record.title) : "Unknown Sound";
  const audioUrl = record.audio_url ? String(record.audio_url) : "";
  if (!id || !audioUrl) return null;
  return {
    id,
    title,
    audio_url: audioUrl,
  };
}

function PositionAvatar({
  position,
  user,
}: {
  position: number;
  user: string;
}) {
  return (
    <div className="relative h-9 w-9 shrink-0">
      <Avatar user={user} className="h-9 w-9" />
      <span
        className={cn(
          "absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center border px-1 text-[9px] font-black tabular-nums",
          getPositionClass(position),
        )}
      >
        {String(position).padStart(2, "0")}
      </span>
    </div>
  );
}

function Panel({
  title,
  icon,
  children,
  className,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <ParticleCard
      className={cn(
        magicBlockClass,
        "h-[calc(100vh-7.5rem)] min-h-[420px] overflow-hidden shadow-wire",
        className,
      )}
      particleCount={12}
      glowColor={magicGlow}
      enableTilt={false}
      enableMagnetism={false}
      clickEffect
    >
      <aside
        className="flex h-full min-h-0 flex-col overflow-hidden border border-border bg-zinc-950/70"
      >
        <div className="flex h-12 items-center justify-between border-b border-border px-4 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">
          <span>{title}</span>
          <span className="text-zinc-600">{icon}</span>
        </div>
        {children}
      </aside>
    </ParticleCard>
  );
}

function MagicButton({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  return (
    <ParticleCard
      className={cn(magicBlockClass, className)}
      particleCount={12}
      glowColor={magicGlow}
      enableTilt={false}
      enableMagnetism={false}
      clickEffect
    >
      {children}
    </ParticleCard>
  );
}

function StatsPanel({
  onOpenDetails,
  stats,
  loading,
}: {
  onOpenDetails: () => void;
  stats: ReturnType<typeof buildStatsSnapshot>;
  loading: boolean;
}) {
  const progress = Math.max(0, Math.min(100, stats.progressPercent));
  const remaining = Math.max(0, stats.nextRankRating - stats.rating);

  return (
    <div
      className={cn(
        "flex h-full flex-col justify-between border border-border bg-zinc-950/80 p-3 text-left transition-opacity duration-300 sm:p-4",
        loading && "opacity-90",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Statistics
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Signal className="h-4 w-4 text-purple-300" aria-hidden="true" />
            <span className="text-lg font-black uppercase tracking-[0.14em] text-zinc-100">
              Stats
            </span>
          </div>
        </div>
        {loading ? (
          <span className="h-7 w-20 animate-pulse border border-zinc-800 bg-zinc-900/80" />
        ) : (
          <span
            className={cn(
              "border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]",
              getRankClass(stats.rank),
            )}
          >
            {stats.rank}
          </span>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
            Current Rating
          </div>
          {loading ? (
            <div className="mt-2 h-10 w-28 animate-pulse bg-zinc-900/80" />
          ) : (
            <div className="mt-1 text-3xl font-black tabular-nums text-zinc-100 transition-all duration-300">
              {stats.rating}
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Progress to {stats.nextRank}
            </span>
            {loading ? (
              <span className="h-4 w-10 animate-pulse bg-zinc-900/80" />
            ) : (
              <span className="text-[10px] font-semibold tabular-nums text-purple-200 transition-all duration-300">
                {progress}%
              </span>
            )}
          </div>
          <div className="h-2 overflow-hidden bg-zinc-900">
            <div
              className={cn(
                "h-full bg-purple-400 shadow-[0_0_14px_rgba(168,85,247,0.9)] transition-[width] duration-500 ease-out",
                loading && "animate-pulse bg-zinc-700 shadow-none",
              )}
              style={{ width: `${loading ? 38 : progress}%` }}
            />
          </div>
          {loading ? (
            <div className="mt-2 h-4 w-24 animate-pulse bg-zinc-900/80" />
          ) : (
            <div className="mt-2 text-[10px] uppercase tracking-[0.12em] text-zinc-600 transition-all duration-300">
              {remaining} rating left
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <div className="border border-zinc-900 bg-black/70 p-2.5">
          <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
            Wins
          </div>
          {loading ? (
            <div className="mt-2 h-5 w-10 animate-pulse bg-zinc-900/80" />
          ) : (
            <div className="mt-1 text-base font-black tabular-nums text-zinc-100 transition-all duration-300">
              {stats.wins}
            </div>
          )}
        </div>
        <div className="border border-zinc-900 bg-black/70 p-2.5">
          <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
            Streak
          </div>
          {loading ? (
            <div className="mt-2 h-5 w-10 animate-pulse bg-zinc-900/80" />
          ) : (
            <div className="mt-1 text-base font-black tabular-nums text-zinc-100 transition-all duration-300">
              +{stats.streak}
            </div>
          )}
        </div>
        <button
          className="inline-flex h-full min-h-[50px] items-center justify-center border border-purple-500/45 bg-purple-950/35 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-purple-200 transition-colors hover:border-purple-300 hover:bg-purple-900/45 hover:text-white"
          onClick={onOpenDetails}
          type="button"
        >
          Details
        </button>
      </div>
    </div>
  );
}

function ChatMessageItem({
  message,
  chatCustomization,
}: {
  message: ChatMessage;
  chatCustomization: ChatCustomization;
}) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className={cn(
        "grid grid-cols-[28px_1fr] gap-2 border border-zinc-900 bg-black/72 p-2 text-left transition-all duration-300 ease-out",
        entered ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        message.mine && "border-purple-500/55 bg-purple-950/25",
        message.pending && "animate-pulse border-purple-400/40",
      )}
    >
      <Avatar user={message.user} className="h-7 w-7" />
      <div className="min-w-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {message.mine && (
              <span
                className={cn(
                  "shrink-0 bg-purple-950/35 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]",
                  getTitleBorderColorClass(chatCustomization.titleBorderColor),
                  getTitleBorderShapeClass(chatCustomization.titleBorderShape),
                  isAnimatedTitle(chatCustomization.title) && "animate-pulse",
                )}
              >
                {chatCustomization.title}
              </span>
            )}
            <span
              className={cn(
                "truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500",
                message.mine && "bg-clip-text font-black text-transparent",
                message.mine && getNickColorClass(chatCustomization.nameColor),
              )}
            >
              {message.user}
            </span>
          </div>
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full shadow-[0_0_10px_rgba(168,85,247,0.85)]",
              message.pending ? "bg-zinc-300" : "bg-purple-400",
            )}
          />
        </div>
        <p
          className={cn(
            "break-words text-xs leading-5 transition-opacity duration-200",
            message.mine ? getChatTextClass(chatCustomization.textStyle) : "text-zinc-300",
            message.pending && "opacity-75",
          )}
        >
          {message.text}
        </p>
      </div>
    </div>
  );
}

function StatsModal({
  onClose,
  stats,
  periodApiData,
  recentForm,
  queueInfo,
}: {
  onClose: () => void;
  stats: ReturnType<typeof buildStatsSnapshot>;
  periodApiData: Partial<Record<StatsPeriodKey, StatsPeriod>>;
  recentForm: string[];
  queueInfo: QueueInfo | null;
}) {
  const [period, setPeriod] = useState<StatsPeriodKey>("today");
  const periodStatsMap = buildPeriodStats(stats, periodApiData);
  const periodStats = periodStatsMap[period];
  const progress = Math.max(0, Math.min(100, stats.progressPercent));
  const remaining = Math.max(0, stats.nextRankRating - periodStats.rating);
  const metrics = [
    { label: "Peak Rating", value: periodStats.peakRating, trend: periodStats.peakTrend },
    { label: "Matches", value: periodStats.matches, trend: periodStats.matchesTrend },
    { label: "Wins", value: periodStats.wins, trend: periodStats.winsTrend },
    { label: "Losses", value: periodStats.losses, trend: periodStats.lossesTrend },
    { label: "Win Rate", value: `${periodStats.winRate}%`, trend: periodStats.winRateTrend },
    { label: "Average Score", value: periodStats.averageScore, trend: periodStats.averageScoreTrend },
    { label: "Avg Gain", value: `+${periodStats.avgGain}`, trend: periodStats.avgGainTrend },
    { label: "Avg Loss", value: `-${periodStats.avgLoss}`, trend: periodStats.avgLossTrend },
  ];
  const getTrendClass = (trend: number) => {
    if (trend > 0) return "border-emerald-400/45 bg-emerald-950/40 text-emerald-300";
    if (trend < 0) return "border-red-400/45 bg-red-950/40 text-red-300";
    return "border-zinc-700 bg-zinc-900 text-zinc-400";
  };
  const getTrendLabel = (trend: number) => {
    if (trend > 0) return "up";
    if (trend < 0) return "down";
    return "flat";
  };
  const formatTrend = (trend: number) => {
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
                {periodStats.rating}
              </div>
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
                      {metric.value}
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

function CustomizeModal({
  chatCustomization,
  gameCustomization,
  resultSoundOptions,
  resultSoundLoading,
  resultSoundVolume,
  onChangeChatCustomization,
  onChangeGameCustomization,
  onChangeResultSoundVolume,
  onSelectResultSound,
  onClose,
}: {
  chatCustomization: ChatCustomization;
  gameCustomization: GameCustomization;
  resultSoundOptions: ResultSoundOption[];
  resultSoundLoading: boolean;
  resultSoundVolume: number;
  onChangeChatCustomization: (next: Partial<ChatCustomization>) => void;
  onChangeGameCustomization: (next: Partial<GameCustomization>) => void;
  onChangeResultSoundVolume: (value: number) => void;
  onSelectResultSound: (sound: ResultSoundOption) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<"menu" | "chat" | "game">("menu");
  const [category, setCategory] = useState<"titles" | "colors" | "text">("titles");
  const [previewSoundId, setPreviewSoundId] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const options = [
    {
      id: "chat" as const,
      title: "Chat",
      description: "Messages, avatar style, badges, and chat effects.",
      icon: MessageSquare,
    },
    {
      id: "game" as const,
      title: "Game",
      description: "Rank visuals, match HUD, queue theme, and effects.",
      icon: Trophy,
    },
  ];
  const titleItems = [
    { label: "RANKED", rarity: "Base", locked: false, animated: false },
    { label: "CHAD", rarity: "Rare", locked: false, animated: false },
    { label: "MOGGER", rarity: "Rare", locked: false, animated: false },
    { label: "ELITE", rarity: "Epic", locked: false, animated: true },
    { label: "ASCENDED", rarity: "Epic", locked: true, animated: true },
    { label: "TRUE ADAM", rarity: "Mythic", locked: true, animated: true },
    { label: "BLACKPILL", rarity: "Mythic", locked: true, animated: true },
    { label: "VOIDKING", rarity: "Legend", locked: true, animated: true },
  ];
  const titleBorderColorOptions = [
    { label: "Purple", className: "bg-purple-400", locked: false },
    { label: "Gold", className: "bg-[#d4af37]", locked: false },
    { label: "Silver", className: "bg-[#c0c0c0]", locked: false },
    { label: "Bronze", className: "bg-[#cd7f32]", locked: false },
    { label: "Crimson", className: "bg-red-400", locked: true },
    { label: "Cyan", className: "bg-cyan-300", locked: true },
  ];
  const titleBorderShapeOptions = [
    { label: "Square", locked: false },
    { label: "Rounded", locked: false },
    { label: "Pill", locked: false },
    { label: "Double", locked: true },
    { label: "Dashed", locked: true },
  ];
  const colorOptions = [
    { label: "Purple", className: "bg-purple-400", gradient: false, locked: false },
    { label: "Gold", className: "bg-[#d4af37]", gradient: false, locked: false },
    { label: "Silver", className: "bg-[#c0c0c0]", gradient: false, locked: false },
    { label: "Bronze", className: "bg-[#cd7f32]", gradient: false, locked: false },
    { label: "Neon", className: "bg-gradient-to-r from-[#5227FF] via-[#FF9FFC] to-[#B497CF]", gradient: true, locked: false },
    { label: "Inferno", className: "bg-gradient-to-r from-red-500 via-orange-300 to-yellow-200", gradient: true, locked: true },
    { label: "Ice", className: "bg-gradient-to-r from-cyan-300 via-sky-400 to-violet-300", gradient: true, locked: true },
    { label: "Toxic", className: "bg-gradient-to-r from-lime-300 via-emerald-400 to-purple-400", gradient: true, locked: true },
  ];
  const textStyleOptions = [
    { label: "Sharp", locked: false },
    { label: "Glitch", locked: false },
    { label: "Minimal", locked: false },
    { label: "Arcade", locked: false },
    { label: "Static", locked: true },
    { label: "Chrome", locked: true },
    { label: "Ghost", locked: true },
    { label: "Signal", locked: true },
  ];
  const isChatView = view === "chat";
  const previewColor = getNickColorClass(chatCustomization.nameColor);
  const categoryItems = [
    { id: "titles" as const, label: "Title" },
    { id: "colors" as const, label: "Nick" },
    { id: "text" as const, label: "Text" },
  ];
  const gameFrameItems = [
    { label: "Neon Grid", locked: false },
    { label: "Steel", locked: false },
    { label: "Gold", locked: false },
    { label: "Carbon", locked: false },
    { label: "Abyss", locked: true },
  ];
  const isGameView = view === "game";
  const selectedResultSound =
    resultSoundOptions.find((sound) => sound.selected) ?? null;

  const stopPreview = useCallback(() => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
      previewAudioRef.current = null;
    }
    setPreviewSoundId(null);
  }, []);

  const handlePreviewSound = useCallback(
    (sound: ResultSoundOption) => {
      if (previewSoundId === sound.id) {
        stopPreview();
        return;
      }
      stopPreview();
      if (!sound.audio_url) return;
      const audio = new Audio(sound.audio_url);
      audio.volume = Math.max(0, Math.min(1, resultSoundVolume));
      audio.onended = () => {
        if (previewAudioRef.current === audio) {
          previewAudioRef.current = null;
          setPreviewSoundId(null);
        }
      };
      audio.onpause = () => {
        if (previewAudioRef.current === audio) {
          previewAudioRef.current = null;
          setPreviewSoundId(null);
        }
      };
      audio.onerror = () => {
        if (previewAudioRef.current === audio) {
          previewAudioRef.current = null;
          setPreviewSoundId(null);
        }
      };
      previewAudioRef.current = audio;
      setPreviewSoundId(sound.id);
      void audio.play().catch(() => {
        if (previewAudioRef.current === audio) {
          previewAudioRef.current = null;
          setPreviewSoundId(null);
        }
      });
    },
    [previewSoundId, resultSoundVolume, stopPreview],
  );

  useEffect(() => {
    if (previewAudioRef.current) {
      previewAudioRef.current.volume = Math.max(0, Math.min(1, resultSoundVolume));
    }
  }, [resultSoundVolume]);

  useEffect(() => {
    return () => {
      stopPreview();
    };
  }, [stopPreview]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customize-modal-title"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-xl border border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
              Customize
            </div>
            <h2
              className="mt-2 text-lg font-black uppercase tracking-[0.14em] text-zinc-100"
              id="customize-modal-title"
            >
              {isChatView
                ? "Chat Settings"
                : isGameView
                  ? "Game Settings"
                  : "Choose Area"}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {view !== "menu" && (
              <button
                className="inline-flex h-10 items-center justify-center border border-zinc-800 bg-black/80 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 transition-colors hover:border-purple-400 hover:text-white"
                onClick={() => setView("menu")}
                type="button"
              >
                Back
              </button>
            )}
            <button
              className="inline-flex h-10 w-10 items-center justify-center border border-zinc-800 bg-black/80 text-zinc-400 transition-colors hover:border-purple-400 hover:text-white"
              onClick={onClose}
              type="button"
              aria-label="Close customization"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {isChatView ? (
          <div className="space-y-5 p-5">
            <div className="grid grid-cols-3 border border-zinc-900 bg-black/60 p-1">
              {categoryItems.map((item) => (
                <button
                  className={cn(
                    "h-9 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 transition-colors hover:text-zinc-100",
                    category === item.id && "bg-purple-950/55 text-purple-100",
                  )}
                  key={item.id}
                  onClick={() => setCategory(item.id)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="max-h-[320px] overflow-y-auto pr-1">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {category === "titles" &&
                  <>
                    {titleItems.map((item) => (
                      <button
                        className={cn(
                          "min-h-24 border bg-black/60 p-3 text-left transition-colors",
                          item.locked && "cursor-not-allowed opacity-45",
                          !item.locked &&
                            (chatCustomization.title === item.label
                              ? "border-purple-400 bg-purple-950/35 text-purple-100"
                              : "border-zinc-700 bg-zinc-900/55 text-zinc-200 hover:border-purple-500/60"),
                        )}
                        disabled={item.locked}
                        key={item.label}
                        onClick={() =>
                          onChangeChatCustomization({ title: item.label })
                        }
                        type="button"
                      >
                        <div className="mb-5 flex items-center justify-between gap-2">
                          <span className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                            {item.rarity}
                          </span>
                          <span className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                            {item.locked ? "Locked" : item.animated ? "Animated" : "Owned"}
                          </span>
                        </div>
                        <div
                          className={cn(
                            "text-xs font-black uppercase tracking-[0.12em]",
                            item.animated && "animate-pulse text-purple-200",
                          )}
                        >
                          {item.label}
                        </div>
                      </button>
                    ))}

                    <div className="border border-zinc-900 bg-black/50 p-3 sm:col-span-2 lg:col-span-3">
                      <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
                        Title Border Color
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {titleBorderColorOptions.map((item) => (
                          <button
                            className={cn(
                              "grid grid-cols-[16px_1fr] items-center gap-2 border px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors",
                              item.locked && "cursor-not-allowed opacity-45",
                              !item.locked &&
                                (chatCustomization.titleBorderColor === item.label
                                  ? "border-purple-400 bg-purple-950/35 text-purple-100"
                                  : "border-zinc-700 bg-zinc-900/55 text-zinc-200 hover:border-purple-500/60"),
                            )}
                            disabled={item.locked}
                            key={item.label}
                            onClick={() =>
                              onChangeChatCustomization({
                                titleBorderColor: item.label,
                              })
                            }
                            type="button"
                          >
                            <span className={cn("h-3 w-3", item.className)} />
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="border border-zinc-900 bg-black/50 p-3 sm:col-span-2 lg:col-span-3">
                      <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
                        Title Border Shape
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {titleBorderShapeOptions.map((item) => (
                          <button
                            className={cn(
                              "border px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors",
                              item.locked && "cursor-not-allowed opacity-45",
                              !item.locked &&
                                (chatCustomization.titleBorderShape === item.label
                                  ? "border-purple-400 bg-purple-950/35 text-purple-100"
                                  : "border-zinc-700 bg-zinc-900/55 text-zinc-200 hover:border-purple-500/60"),
                            )}
                            disabled={item.locked}
                            key={item.label}
                            onClick={() =>
                              onChangeChatCustomization({
                                titleBorderShape: item.label,
                              })
                            }
                            type="button"
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>}

                {category === "colors" &&
                  colorOptions.map((item) => (
                    <button
                      className={cn(
                        "min-h-24 border bg-black/60 p-3 text-left transition-colors",
                        item.locked && "cursor-not-allowed opacity-45",
                        !item.locked &&
                          (chatCustomization.nameColor === item.label
                            ? "border-purple-400 bg-purple-950/35 text-purple-100"
                            : "border-zinc-700 bg-zinc-900/55 text-zinc-200 hover:border-purple-500/60"),
                      )}
                      disabled={item.locked}
                      key={item.label}
                      onClick={() =>
                        onChangeChatCustomization({ nameColor: item.label })
                      }
                      type="button"
                    >
                      <div className="mb-5 flex items-center justify-between gap-2">
                        <span className={cn("h-4 w-4", item.className)} />
                        <span className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                          {item.locked ? "Locked" : item.gradient ? "Gradient" : "Solid"}
                        </span>
                      </div>
                      <div className="text-xs font-black uppercase tracking-[0.12em]">
                        {item.label}
                      </div>
                    </button>
                  ))}

                {category === "text" &&
                  textStyleOptions.map((item) => (
                    <button
                      className={cn(
                        "min-h-24 border bg-black/60 p-3 text-left transition-colors",
                        item.locked && "cursor-not-allowed opacity-45",
                        !item.locked &&
                          (chatCustomization.textStyle === item.label
                            ? "border-purple-400 bg-purple-950/35 text-purple-100"
                            : "border-zinc-700 bg-zinc-900/55 text-zinc-200 hover:border-purple-500/60"),
                      )}
                      disabled={item.locked}
                      key={item.label}
                      onClick={() =>
                        onChangeChatCustomization({ textStyle: item.label })
                      }
                      type="button"
                    >
                      <div className="mb-5 text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                        {item.locked ? "Locked" : "Owned"}
                      </div>
                      <div className="text-xs font-black uppercase tracking-[0.12em]">
                        {item.label}
                      </div>
                    </button>
                  ))}
              </div>
            </div>

            <div className="border border-zinc-900 bg-black/60 p-4">
              <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                Preview
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span
                  className={cn(
                    "bg-purple-950/35 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]",
                    getTitleBorderColorClass(chatCustomization.titleBorderColor),
                    getTitleBorderShapeClass(chatCustomization.titleBorderShape),
                  )}
                >
                  {chatCustomization.title}
                </span>
                <span
                  className={cn(
                    "bg-clip-text text-sm font-black uppercase tracking-[0.12em] text-transparent",
                    previewColor,
                  )}
                >
                  volatileMS
                </span>
                <span
                  className={cn(
                    "text-xs",
                    getChatTextClass(chatCustomization.textStyle),
                  )}
                >
                  {chatCustomization.textStyle} message style
                </span>
              </div>
            </div>
          </div>
        ) : isGameView ? (
          <div className="space-y-5 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
                  Frame Type
                </div>
                {gameFrameItems.map((item) => (
                  <button
                    className={cn(
                      "w-full border px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors",
                      item.locked && "cursor-not-allowed opacity-45",
                      !item.locked &&
                        (gameCustomization.frame === item.label
                          ? "border-purple-400 bg-purple-950/35 text-purple-100"
                          : "border-zinc-700 bg-zinc-900/55 text-zinc-200 hover:border-purple-500/60"),
                    )}
                    disabled={item.locked}
                    key={item.label}
                    onClick={() =>
                      onChangeGameCustomization({ frame: item.label })
                    }
                    type="button"
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
                    Result Sound
                  </div>
                  {resultSoundLoading && (
                    <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                      Loading...
                    </div>
                  )}
                </div>
                <div className="border border-zinc-900 bg-black/50 p-3">
                  <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                    <span>Volume</span>
                    <span className="text-zinc-300">{Math.round(resultSoundVolume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={resultSoundVolume}
                    onChange={(event) =>
                      onChangeResultSoundVolume(Number(event.target.value))
                    }
                    className="w-full accent-purple-400"
                  />
                </div>
                <div className="max-h-[264px] space-y-2 overflow-y-auto pr-1">
                  {resultSoundOptions.map((sound) => {
                    const locked = !sound.owned;
                    return (
                      <div className="grid grid-cols-[1fr_auto] gap-2" key={sound.id}>
                        <button
                          className={cn(
                            "border px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors",
                            locked && "cursor-not-allowed border-zinc-900 bg-black/60 text-zinc-700",
                            !locked &&
                              (sound.selected
                                ? "border-purple-400 bg-purple-950/35 text-purple-100"
                                : "border-zinc-700 bg-zinc-900/55 text-zinc-200 hover:border-purple-500/60"),
                          )}
                          disabled={locked}
                          onClick={() => onSelectResultSound(sound)}
                          type="button"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span>{sound.title}</span>
                            <span className="text-[9px] uppercase tracking-[0.12em] text-zinc-500">
                              {locked ? "Locked" : sound.selected ? "Selected" : sound.is_default ? "Default" : "Owned"}
                            </span>
                          </div>
                        </button>
                        <button
                          className={cn(
                            "border px-3 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors",
                            !sound.audio_url
                              ? "cursor-not-allowed border-zinc-900 bg-black/60 text-zinc-700"
                              : "border-zinc-700 bg-zinc-900/55 text-zinc-200 hover:border-purple-500/60",
                          )}
                          disabled={!sound.audio_url}
                          onClick={() => handlePreviewSound(sound)}
                          type="button"
                        >
                          {previewSoundId === sound.id ? "Stop" : "Start"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="border border-zinc-900 bg-black/60 p-4">
              <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                Game Preview
              </div>
              <div className="mt-3">
                <div
                  className={cn(
                    "border p-2",
                    getGameFrameClass(gameCustomization.frame),
                  )}
                >
                  <div className="border border-zinc-900 bg-black/75 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                        Active Frame
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.12em] text-zinc-300">
                        {gameCustomization.frame}
                      </span>
                    </div>
                    <div className="mt-3 h-10 border border-zinc-800 bg-zinc-950/70" />
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                    Result Sound: {selectedResultSound?.title ?? gameCustomization.victorySound}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                    Pick from list above
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            {options.map((option) => {
              const Icon = option.icon;

              return (
                <button
                  className={cn(
                    "min-h-44 border bg-black/60 p-4 text-left transition-colors",
                    "border-zinc-900 hover:border-purple-400 hover:bg-purple-950/24 hover:shadow-[0_0_22px_rgba(132,0,255,0.18)]",
                  )}
                  key={option.id}
                  onClick={() => {
                    if (option.id === "chat") setView("chat");
                    else setView("game");
                  }}
                  type="button"
                >
                  <div className="mb-8 flex items-center justify-between">
                    <Icon
                      className="h-5 w-5 text-zinc-500 transition-colors"
                      aria-hidden="true"
                    />
                    <span className="h-2 w-2 bg-zinc-800" />
                  </div>
                  <div className="text-base font-black uppercase tracking-[0.14em] text-zinc-100">
                    {option.title}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-zinc-500">
                    {option.description}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function LiveChat({
  chatCustomization,
  currentUserName,
  accessToken,
}: {
  chatCustomization: ChatCustomization;
  currentUserName: string;
  accessToken: string | null;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialChatMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const nextIdRef = useRef(initialChatMessages.length + 1);

  useEffect(() => {
    if (!accessToken) return;
    let mounted = true;
    const controller = new AbortController();

    const messageKey = (msg: ChatMessage) =>
      String(msg.id ?? `${msg.user}|${msg.text}|${msg.createdAt ?? ""}`);

    const messageSignature = (user: string, text: string) =>
      `${user.trim().toLowerCase()}|${text.trim().toLowerCase()}`;

    const dedupeMessages = (list: ChatMessage[]) => {
      const seen = new Set<string>();
      const out: ChatMessage[] = [];
      for (const item of list) {
        const key = messageKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
      }
      return out;
    };

    const mapIncoming = (msg: LiveChatMessage): ChatMessage => {
      const user = (msg.sender_nickname ?? msg.nickname ?? msg.user ?? "USER").toString();
      const mine = user.toLowerCase() === currentUserName.toLowerCase();
      return {
        id:
          msg.id ??
          msg.sender_id ??
          `${user}|${msg.text ?? ""}|${msg.created_at ?? ""}`,
        createdAt: msg.created_at,
        user,
        text: msg.text ?? "",
        mine,
      };
    };

    const run = async () => {
      try {
        const history = await getLiveChatHistory(accessToken);
        if (!mounted) return;
        setMessages(dedupeMessages(history.map(mapIncoming)).slice(-40));
      } catch {
        // keep UI usable even if history fails
      }

      try {
        await streamLiveChat(
          accessToken,
          (event, data) => {
            if (!mounted) return;
            const payload = data as Record<string, unknown>;
            if (event === "history") {
              const history =
                (payload.history as LiveChatMessage[] | undefined) ??
                (payload.messages as LiveChatMessage[] | undefined) ??
                [];
              setMessages(dedupeMessages(history.map(mapIncoming)).slice(-40));
              return;
            }
            if (event === "message") {
              const msg = (payload.message as LiveChatMessage | undefined) ??
                (payload as unknown as LiveChatMessage);
              if (!msg?.text) return;
              const incoming = mapIncoming(msg);
              const incomingSignature = messageSignature(incoming.user, incoming.text);
              setMessages((current) =>
                dedupeMessages([
                  ...current
                    .filter(
                      (item) =>
                        !(
                          item.pending &&
                          messageSignature(item.user, item.text) === incomingSignature
                        ),
                    )
                    .slice(-39),
                  incoming,
                ]).slice(-40),
              );
            }
          },
          controller.signal,
        );
      } catch {
        // stream reconnect strategy can be added later
      }
    };

    void run();
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [accessToken, currentUserName]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !accessToken || sending) return;

    const optimisticId = `pending-${nextIdRef.current++}`;
    setMessages((current) => [
      ...current.slice(-39),
      {
        id: optimisticId,
        user: currentUserName,
        text,
        mine: true,
        pending: true,
      },
    ]);
    setDraft("");
    setSending(true);
    try {
      await sendLiveChatMessage(accessToken, text);
    } catch {
      setMessages((current) =>
        current.map((item) =>
          item.id === optimisticId ? { ...item, pending: false } : item,
        ),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-3">
        {messages.map((message) => (
          <ChatMessageItem
            chatCustomization={chatCustomization}
            key={message.id}
            message={message}
          />
        ))}
        <div ref={chatEndRef} />
      </div>

      <form
        className="grid grid-cols-[1fr_40px] gap-2 border-t border-border p-3"
        onSubmit={handleSubmit}
      >
        <input
          className="h-10 min-w-0 border border-zinc-800 bg-black/80 px-3 text-xs tracking-[0.08em] text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-purple-400"
          onChange={(event) => setDraft(event.target.value)}
          placeholder="TYPE MESSAGE"
          value={draft}
        />
        <button
          className="inline-flex h-10 w-10 items-center justify-center border border-purple-500/50 bg-purple-950/45 text-purple-200 shadow-[0_0_16px_rgba(132,0,255,0.18)] transition-colors hover:border-purple-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          type="submit"
          aria-label="Send message"
          disabled={!accessToken || sending}
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}

function AuthModal({
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-md border border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)]"
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

function VerificationModal({
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
    let faceLandmarker: {
      detectForVideo: (video: HTMLVideoElement, now: number) => {
        faceLandmarks?: Array<Array<{ x: number; y: number; z?: number }>>;
        facialTransformationMatrixes?: Array<{ data?: number[] } | number[]>;
      };
      close?: () => void;
    } | null = null;
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

        const importFromUrl = new Function(
          "url",
          "return import(url)",
        ) as (url: string) => Promise<unknown>;
        const vision = (await importFromUrl(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14",
        )) as {
          FilesetResolver: {
            forVisionTasks: (
              basePath: string,
            ) => Promise<unknown>;
          };
          FaceLandmarker: {
            createFromOptions: (
              fileset: unknown,
              options: Record<string, unknown>,
            ) => Promise<{
              detectForVideo: (
                video: HTMLVideoElement,
                now: number,
              ) => {
                faceLandmarks?: Array<Array<{ x: number; y: number; z?: number }>>;
                facialTransformationMatrixes?: Array<{ data?: number[] } | number[]>;
              };
              close?: () => void;
            }>;
          };
        };

        const fileset = await vision.FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
        );

        faceLandmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: true,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

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
      faceLandmarker?.close?.();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [session.blink_count, session.turn_left, session.turn_right, setDetected]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/78 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="verification-title"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-2xl border border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)]"
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
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/72 p-4 text-center">
                <div className="border border-zinc-800 bg-zinc-950 px-4 py-3">
                  {cameraState === "loading" && (
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-300">
                      Opening camera...
                    </div>
                  )}
                  {cameraState === "ready" && trackerState === "loading" && (
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-300">
                      Loading face tracker...
                    </div>
                  )}
                  {cameraState === "error" && (
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-red-300">
                      Camera access failed
                    </div>
                  )}
                  {cameraState !== "error" && trackerState === "error" && (
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-red-300">
                      Face tracker failed to load
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
                  Verification cannot continue until the face tracker loads. Close this window and try again.
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

function getRankClass(rank: string) {
  switch (rank) {
    case "TRUE ADAM":
      return "border-fuchsia-300/70 bg-fuchsia-400/10 text-fuchsia-200 shadow-[0_0_14px_rgba(217,70,239,0.24)]";
    case "CHAD":
      return "border-purple-400/60 bg-purple-500/10 text-purple-200";
    case "CHADLITE":
      return "border-sky-400/55 bg-sky-500/10 text-sky-200";
    case "HTN":
      return "border-emerald-400/55 bg-emerald-500/10 text-emerald-200";
    case "MTN":
      return "border-cyan-300/55 bg-cyan-500/10 text-cyan-200";
    case "LTN":
      return "border-yellow-400/55 bg-yellow-500/10 text-yellow-200";
    case "SUB5":
      return "border-orange-400/55 bg-orange-500/10 text-orange-200";
    case "SUBHUMAN":
      return "border-zinc-500/55 bg-zinc-800/70 text-zinc-200";
    default:
      return "border-zinc-600 bg-zinc-800/50 text-zinc-300";
  }
}

function getTopClass(position: number) {
  if (position === 1) {
    return "border-zinc-800 bg-black/76";
  }
  if (position === 2) {
    return "border-zinc-800 bg-black/74";
  }
  if (position === 3) {
    return "border-zinc-800 bg-black/72";
  }
  return "border-zinc-900 bg-black/72";
}

function getTopAccentClass(position: number) {
  if (position === 1) return "bg-[#d4af37]";
  if (position === 2) return "bg-[#c0c0c0]";
  if (position === 3) return "bg-[#cd7f32]";
  return "bg-transparent";
}

function getPositionClass(position: number) {
  if (position === 1) {
    return "border-[#d4af37]/70 bg-[#d4af37]/10 text-[#f5d76e]";
  }
  if (position === 2) {
    return "border-[#c0c0c0]/65 bg-[#c0c0c0]/10 text-[#e5e7eb]";
  }
  if (position === 3) {
    return "border-[#cd7f32]/65 bg-[#cd7f32]/10 text-[#e3a05f]";
  }
  return "border-zinc-800 bg-black/70 text-zinc-500";
}

function getTopGradientColors(position: number) {
  if (position === 1) return ["#7a5a00", "#ffd86b", "#fff4b8"];
  if (position === 2) return ["#6f7680", "#f1f5f9", "#a8b0ba"];
  if (position === 3) return ["#7a3f16", "#f0a35b", "#ffd0a1"];
  return ["#e4e4e7", "#a1a1aa", "#f4f4f5"];
}

function TopsLeaderboard({
  entries,
  loading,
}: {
  entries: LeaderboardEntry[];
  loading: boolean;
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
                <PositionAvatar position={position} user={player.nickname} />
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
                    <div className="truncate text-xs font-black uppercase tracking-[0.14em] text-zinc-200">
                      {player.nickname}
                    </div>
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

function StartModesModal({
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="start-modes-title"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-2xl border border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)]"
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
            const isDisabled = Boolean(searchingMode) && !isActive;
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
                    )}
                  />
                </div>
                <div className="text-sm font-black uppercase tracking-[0.14em] text-zinc-100">
                  {mode.title}
                </div>
                <p className="mt-3 text-xs leading-5 text-zinc-500">
                  {mode.description}
                </p>
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

function DuelModal({
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
  onFinished?: () => void;
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
  } | null>(null);
  const [mediaReadyMap, setMediaReadyMap] = useState<Record<string, boolean>>({});
  const [queueRunKey, setQueueRunKey] = useState(0);
  const [searchSoundEnabled, setSearchSoundEnabled] = useState(true);
  const [searchVolume, setSearchVolume] = useState(0.18);
  const [showFinalResult, setShowFinalResult] = useState(false);
  const finishedRef = useRef(false);

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
              : "Queue";
  const phaseDescription =
    phase === "awaiting_media"
      ? "Waiting for both cameras."
    : phase === "pre_start"
      ? "Get ready."
      : phase === "scoring"
        ? "Scoring."
        : phase === "overtime"
          ? "Close match. Extra time is active."
          : phase === "result"
            ? "Match complete. Final result is being prepared."
            : phase === "post_chat"
              ? "Post chat."
              : phase === "finished"
                ? "Duel finished."
                : "Searching for an opponent.";
  const stageSteps = [
    { id: "awaiting_media", label: "Media" },
    { id: "pre_start", label: "Pre Start" },
    { id: "scoring", label: "Scoring" },
    { id: "finished", label: "Result" },
  ];
  const currentStepIndex =
    phase === "awaiting_media"
      ? 0
      : phase === "pre_start"
        ? 1
        : phase === "scoring" || phase === "overtime"
          ? 2
          : phase === "result" || phase === "post_chat" || phase === "finished"
            ? 3
            : -1;
  const isResultPhase =
    phase === "result" || phase === "post_chat" || phase === "finished";
  const isTerminalPhase = useCallback((value: string | null | undefined) => {
    return value === "result" || value === "post_chat" || value === "finished";
  }, []);
  const myMediaReady = myUserId ? Boolean(mediaReadyMap[myUserId]) : false;
  const opponentMediaReady = opponentUserId ? Boolean(mediaReadyMap[opponentUserId]) : false;
  const myLost = Boolean(resultSummary?.loserId && myUserId && resultSummary.loserId === myUserId);
  const opponentLost = Boolean(resultSummary?.loserId && myUserId && resultSummary.loserId !== myUserId);

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
    if (mediaReady && typeof mediaReady === "object") {
      setMediaReadyMap(
        Object.fromEntries(
          Object.entries(mediaReady).map(([key, value]) => [key, Boolean(value)]),
        ),
      );
    }
    if (rawResultSounds && typeof rawResultSounds === "object") {
      const normalized = Object.fromEntries(
        Object.entries(rawResultSounds)
          .map(([userID, value]) => [userID, normalizeDuelResultSound(value)])
          .filter((entry): entry is [string, DuelResultSound] => Boolean(entry[1])),
      );
      preloadResultSoundsMap(normalized);
    }
    if (Array.isArray(players) && myUserId) {
      const mine = players.find((player) => String(player.user_id ?? "") === myUserId);
      const opponent = players.find((player) => String(player.user_id ?? "") !== myUserId);

      if (mine) {
        const mineAvg =
          (mine.running_avg as number | undefined) ??
          (mine.final_avg as number | undefined);
        const mineScore = mine.last_score as number | undefined;
        if (typeof mineAvg === "number") setMyAvg(mineAvg);
        if (typeof mineScore === "number") setMyScore(mineScore);
      }

      if (opponent) {
        const opponentId = opponent.user_id ? String(opponent.user_id) : null;
        const opponentAvg =
          (opponent.running_avg as number | undefined) ??
          (opponent.final_avg as number | undefined);
        const opponentScore = opponent.last_score as number | undefined;
        if (opponentId) setOpponentUserId(opponentId);
        if (typeof opponentAvg === "number") setOppAvg(opponentAvg);
        if (typeof opponentScore === "number") setOppScore(opponentScore);
      }

      const result = match.result as Record<string, unknown> | undefined;
      if (result) {
        setResultSummary({
          winnerId: result.winner_id ? String(result.winner_id) : null,
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
        });
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
  }, [extractMatchRecord, extractPhase, myUserId, preloadResultSoundsMap]);

  const resetMatchFlow = useCallback(() => {
    stopResultSound();
    finishedRef.current = false;
    mediaReadySentRef.current = false;
    setQueueing(false);
    setMatchID("");
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
    remoteStreamRef.current = null;
    preloadedSoundBuffersRef.current.clear();
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
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
  }, []);

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
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    peerRef.current = pc;
    makingOfferRef.current = false;
    ignoreOfferRef.current = false;
    pendingCandidatesRef.current = [];

    for (const track of streamRef.current.getTracks()) {
      pc.addTrack(track, streamRef.current);
    }

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (!remoteStream) return;
      remoteStreamRef.current = remoteStream;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
        void remoteVideoRef.current.play().catch(() => {});
        if (
          accessToken &&
          matchID &&
          streamRef.current &&
          remoteVideoRef.current.srcObject &&
          !mediaReadySentRef.current
        ) {
          mediaReadySentRef.current = true;
          void duelMediaReady(accessToken, matchID).catch((error: unknown) => {
            mediaReadySentRef.current = false;
            setError(error instanceof Error ? error.message : "Failed to confirm media");
          });
        }
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
      pushDebug(`pc.connectionState=${pc.connectionState}`);
    };
    pc.oniceconnectionstatechange = () => {
      pushDebug(`pc.iceConnectionState=${pc.iceConnectionState}`);
    };
    pc.onsignalingstatechange = () => {
      pushDebug(`pc.signalingState=${pc.signalingState}`);
    };

    // offer is sent explicitly by deterministic offerer (myUserId < opponentUserId)

    return () => {
      peerRef.current?.close();
      peerRef.current = null;
      remoteStreamRef.current = null;
      mediaReadySentRef.current = false;
      pendingCandidatesRef.current = [];
      makingOfferRef.current = false;
      ignoreOfferRef.current = false;
    };
  }, [accessToken, matchID, pushDebug]);

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
  }, [accessToken, matchID, isOfferer, pushDebug, opponentUserId]);

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
          void playPreloadedResultSound(winnerSoundId, winnerSound);
          if (!finishedRef.current) {
            finishedRef.current = true;
            onFinished?.();
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
  }, [accessToken, matchID, pushDebug, pickSignalPayload, myUserId, extractUsersFromMatch, onFinished, applyMatchSnapshot, extractPhase, playPreloadedResultSound]);

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
    if (!isResultPhase || !resultSummary) {
      setShowFinalResult(false);
      return;
    }
    setShowFinalResult(false);
    const timer = window.setTimeout(() => {
      setShowFinalResult(true);
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [isResultPhase, resultSummary, matchID]);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="duel-title"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-6xl border border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)]"
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
        <div className="p-5">
          {isQueueScreen ? (
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
            <div className="relative grid min-h-[72vh] gap-4 lg:grid-cols-2">
              <div className="group relative overflow-hidden border border-zinc-800 bg-black/85">
                <video
                  ref={videoRef}
                  className="h-full min-h-[320px] w-full object-cover"
                  muted
                  playsInline
                  autoPlay
                />
                <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/80 to-transparent" />
                <div className="absolute left-4 top-28 border border-purple-500/45 bg-zinc-950 px-3 py-2 shadow-[0_0_18px_rgba(0,0,0,0.45)]">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                    You
                  </div>
                  <div className="mt-1 text-lg font-black tabular-nums text-zinc-100">
                    {myScore === null ? "--" : `${(myScore * 2).toFixed(1)}/10`}
                  </div>
                  <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-purple-200">
                    Avg {myAvg === null ? "--" : `${(myAvg * 2).toFixed(1)}/10`}
                  </div>
                </div>
                {isResultPhase && resultSummary && !showFinalResult && myLost && (
                  <div className="pointer-events-none absolute inset-x-[12%] top-[30%] z-20 flex justify-center">
                    <div className="-rotate-2 border border-red-500/65 bg-red-950/48 px-6 py-3 text-4xl font-black uppercase tracking-[0.2em] text-red-300 shadow-[0_0_24px_rgba(248,113,113,0.45)] drop-shadow-[0_0_18px_rgba(248,113,113,0.8)]">
                      MOGGED
                    </div>
                  </div>
                )}
              </div>

              <div className="group relative overflow-hidden border border-zinc-800 bg-black/85">
                <video
                  ref={remoteVideoRef}
                  className="h-full min-h-[320px] w-full object-cover"
                  playsInline
                  autoPlay
                />
                <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/80 to-transparent" />
                <div className="absolute right-4 top-28 border border-zinc-700 bg-zinc-950 px-3 py-2 text-right shadow-[0_0_18px_rgba(0,0,0,0.45)]">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                    Opponent
                  </div>
                  <div className="mt-1 text-lg font-black tabular-nums text-zinc-100">
                    {oppScore === null ? "--" : `${(oppScore * 2).toFixed(1)}/10`}
                  </div>
                  <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-zinc-300">
                    Avg {oppAvg === null ? "--" : `${(oppAvg * 2).toFixed(1)}/10`}
                  </div>
                </div>
                {isResultPhase && resultSummary && !showFinalResult && opponentLost && (
                  <div className="pointer-events-none absolute inset-x-[12%] top-[30%] z-20 flex justify-center">
                    <div className="rotate-2 border border-red-500/65 bg-red-950/48 px-6 py-3 text-4xl font-black uppercase tracking-[0.2em] text-red-300 shadow-[0_0_24px_rgba(248,113,113,0.45)] drop-shadow-[0_0_18px_rgba(248,113,113,0.8)]">
                      MOGGED
                    </div>
                  </div>
                )}
              </div>

              <div className="pointer-events-none absolute inset-x-0 top-28 z-20 flex justify-center">
                <div className="border border-zinc-700 bg-zinc-950 px-4 py-2 text-center shadow-[0_0_24px_rgba(132,0,255,0.16)]">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    {phaseLabel}
                  </div>
                  <div className="mt-1 text-2xl font-black uppercase tracking-[0.16em] text-zinc-100">
                    VS
                  </div>
                </div>
              </div>

              <div className="absolute inset-x-6 top-6 z-20">
                <div className="grid gap-2 sm:grid-cols-4">
                  {stageSteps.map((step, index) => {
                    const active = currentStepIndex === index;
                    const complete = currentStepIndex > index;
                    return (
                      <div
                        key={step.id}
                        className={cn(
                          "border px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.14em]",
                          active && "border-purple-400/60 bg-purple-950/55 text-purple-100",
                          complete && "border-emerald-400/35 bg-emerald-950/30 text-emerald-200",
                          !active && !complete && "border-zinc-800 bg-zinc-950 text-zinc-500",
                        )}
                      >
                        {step.label}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="absolute inset-x-6 bottom-6 z-20">
                <div className="border border-zinc-800 bg-zinc-950 px-4 py-3 shadow-[0_0_24px_rgba(0,0,0,0.42)]">
                  <div className="mb-2 flex items-center justify-between gap-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    <span>{status || "Live Match"}</span>
                    <span className="text-purple-200">{secondsLeft ?? 0}s</span>
                  </div>
                  <div className="mb-3 text-[11px] uppercase tracking-[0.1em] text-zinc-400">
                    {phaseDescription}
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
                      className="h-full bg-purple-400 transition-[width] duration-300 ease-out shadow-[0_0_14px_rgba(168,85,247,0.8)]"
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
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/88 p-6">
                  <div className="w-full max-w-xl border border-purple-500/35 bg-zinc-950 p-6 text-center shadow-[0_0_40px_rgba(132,0,255,0.22)]">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                      Match Result
                    </div>
                    <div className="mt-4 text-3xl font-black uppercase tracking-[0.14em] text-zinc-100">
                      {resultSummary.winnerId && myUserId && resultSummary.winnerId === myUserId
                        ? "Victory"
                        : resultSummary.winnerId
                          ? "Defeat"
                          : "Finished"}
                    </div>
                    <div className="mt-3 text-xs uppercase tracking-[0.12em] text-zinc-500">
                      {resultSummary.reason ? `Reason: ${resultSummary.reason}` : "Final scores"}
                    </div>

                    <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                      <div className="border border-zinc-800 bg-black/70 p-4">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                          {resultSummary.myNickname ?? "You"}
                        </div>
                        <div className="mt-2 text-2xl font-black tabular-nums text-zinc-100">
                          {formatScoreOutOfTen(resultSummary.myFinal)}
                        </div>
                      </div>
                      <div className="text-lg font-black uppercase tracking-[0.16em] text-purple-200">
                        VS
                      </div>
                      <div className="border border-zinc-800 bg-black/70 p-4">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                          {resultSummary.oppNickname ?? "Opponent"}
                        </div>
                        <div className="mt-2 text-2xl font-black tabular-nums text-zinc-100">
                          {formatScoreOutOfTen(resultSummary.oppFinal)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 grid gap-2 sm:grid-cols-2">
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
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getRoomID(room: TestLabRoom | null) {
  if (!room) return "";
  const direct = room.id ?? room.room_id;
  return direct ? String(direct) : "";
}

function formatScoreOutOfTen(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  const scaled = Math.max(0, Math.min(10, value * 2));
  const rounded = Math.round(scaled * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}/10`;
}

function TestLabModal({
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
    let faceLandmarker: {
      detectForVideo: (video: HTMLVideoElement, now: number) => {
        faceLandmarks?: Array<Array<{ x: number; y: number; z?: number }>>;
      };
      close?: () => void;
    } | null = null;

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
        const importFromUrl = new Function(
          "url",
          "return import(url)",
        ) as (url: string) => Promise<unknown>;
        const vision = (await importFromUrl(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14",
        )) as {
          FilesetResolver: { forVisionTasks: (basePath: string) => Promise<unknown> };
          FaceLandmarker: {
            createFromOptions: (
              fileset: unknown,
              options: Record<string, unknown>,
            ) => Promise<{
              detectForVideo: (
                video: HTMLVideoElement,
                now: number,
              ) => { faceLandmarks?: Array<Array<{ x: number; y: number; z?: number }>> };
              close?: () => void;
            }>;
          };
        };
        const fileset = await vision.FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
        );
        faceLandmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
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
      faceLandmarker?.close?.();
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="test-lab-title"
      onMouseDown={() => {
        if (canClose) onClose(completedRef.current);
      }}
    >
      <div
        className="w-full max-w-6xl border border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)]"
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
        <div className="grid gap-4 p-5 lg:grid-cols-[1.7fr_1fr]">
          {phase === "result" ? (
            <div className="flex min-h-72 items-center justify-center border border-zinc-800 bg-black/80 p-6 text-center">
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
                className="h-full min-h-[520px] w-full object-cover"
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
                  <div className="text-6xl font-black tabular-nums text-white">{countdown}</div>
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
          <div className="space-y-3">
            <div className="border border-zinc-800 bg-black/60 p-3 text-[10px] uppercase tracking-[0.12em] text-zinc-500">
              Room: {roomID || (loadingRoom ? "Creating..." : "-")}
            </div>
            {phase === "result" ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="border border-zinc-800 bg-black/60 p-3">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Best</div>
                  <div className="mt-1 text-lg font-black tabular-nums text-zinc-100">
                    {formatScoreOutOfTen(bestScore)}
                  </div>
                </div>
                <div className="border border-zinc-800 bg-black/60 p-3">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Average</div>
                  <div className="mt-1 text-lg font-black tabular-nums text-zinc-100">
                    {formatScoreOutOfTen(averageScore)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="border border-zinc-800 bg-black/60 p-3 text-[10px] uppercase tracking-[0.12em] text-zinc-400">
                {phase === "waiting_camera" && "Waiting for camera permission"}
                {phase === "countdown" && "Get ready"}
                {phase === "scanning" && "Scanning in progress"}
              </div>
            )}
            <div className="border border-zinc-800 bg-black/60 p-3">
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

function AnonymousProgressModal({
  onLogin,
  onRegister,
  onClose,
}: {
  onLogin: () => void;
  onRegister: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="anonymous-progress-title"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-md border border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
              Anonymous Session
            </div>
            <h2
              id="anonymous-progress-title"
              className="mt-2 text-lg font-black uppercase tracking-[0.14em] text-zinc-100"
            >
              Progress Won't Save
            </h2>
          </div>
          <button
            className="inline-flex h-10 w-10 items-center justify-center border border-zinc-800 bg-black/80 text-zinc-400 transition-colors hover:border-purple-400 hover:text-white"
            onClick={onClose}
            type="button"
            aria-label="Close anonymous progress prompt"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div className="border border-zinc-800 bg-black/60 px-4 py-3 text-sm leading-6 text-zinc-300">
            You are playing as an anonymous user. Match progress, stats, and rewards will not be
            saved after you leave.
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              size="wireMedium"
              className="h-11"
              onClick={onRegister}
            >
              Register
            </Button>
            <Button
              type="button"
              size="wireMedium"
              variant="outline"
              className="h-11"
              onClick={onLogin}
            >
              Login
            </Button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-full border border-zinc-800 bg-black/70 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-300"
          >
            Continue as Anonymous
          </button>
        </div>
      </div>
    </div>
  );
}

function VerificationStartingModal({
  status,
}: {
  status: string | null;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/78 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="verification-starting-title"
    >
      <div className="w-full max-w-md border border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)]">
        <div className="border-b border-border px-5 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
            Verification
          </div>
          <h2
            id="verification-starting-title"
            className="mt-2 text-lg font-black uppercase tracking-[0.14em] text-zinc-100"
          >
            Starting Camera Check
          </h2>
        </div>
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-3 border border-zinc-800 bg-black/60 px-4 py-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-purple-300" />
            <div className="text-sm text-zinc-300">
              {status ?? "Contacting verification service..."}
            </div>
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
            Please wait. The webcam step will open automatically.
          </div>
        </div>
      </div>
    </div>
  );
}

function BackendStatusModal({
  message,
}: {
  message: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/82 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="backend-status-title"
    >
      <div className="w-full max-w-xl border border-red-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(239,68,68,0.18)]">
        <div className="border-b border-border px-5 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
            Service Status
          </div>
          <h2
            id="backend-status-title"
            className="mt-2 text-lg font-black uppercase tracking-[0.14em] text-zinc-100"
          >
            Something Broke
          </h2>
        </div>
        <div className="space-y-4 p-5">
          <div className="border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm leading-6 text-zinc-200">
            {message}
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-11 w-full items-center justify-center border border-red-500/45 bg-red-950/35 text-[10px] font-semibold uppercase tracking-[0.14em] text-red-100 transition-colors hover:border-red-300 hover:text-white"
          >
            Reload Page
          </button>
        </div>
      </div>
    </div>
  );
}

function LegalModal({
  kind,
  onClose,
}: {
  kind: "rules" | "privacy";
  onClose: () => void;
}) {
  const isRules = kind === "rules";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/78 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-modal-title"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-2xl border border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
              Legal
            </div>
            <h2
              id="legal-modal-title"
              className="mt-2 text-lg font-black uppercase tracking-[0.14em] text-zinc-100"
            >
              {isRules ? "Rules" : "Privacy Policy"}
            </h2>
          </div>
          <button
            className="inline-flex h-10 w-10 items-center justify-center border border-zinc-800 bg-black/80 text-zinc-400 transition-colors hover:border-purple-400 hover:text-white"
            onClick={onClose}
            type="button"
            aria-label="Close legal modal"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5 text-sm leading-6 text-zinc-300">
          {isRules ? (
            <>
              <div className="border border-zinc-800 bg-black/60 px-4 py-3">
                Use the service lawfully, do not harass other users, and do not upload illegal,
                exploitative, or non-consensual content.
              </div>
              <div className="border border-zinc-800 bg-black/60 px-4 py-3">
                You must be at least 18 years old to use camera-based features, matchmaking, and
                chat.
              </div>
              <div className="border border-zinc-800 bg-black/60 px-4 py-3">
                Do not impersonate other people, attempt to bypass moderation, attack the service,
                or interfere with other matches.
              </div>
              <div className="border border-zinc-800 bg-black/60 px-4 py-3">
                Accounts, ratings, and access may be limited or removed for abuse, fraud, or
                repeated policy violations.
              </div>
            </>
          ) : (
            <>
              <div className="border border-zinc-800 bg-black/60 px-4 py-3">
                The service may process your account data, nickname, authentication data, chat
                messages, camera frames used for verification or scoring, and technical logs needed
                for security and operation.
              </div>
              <div className="border border-zinc-800 bg-black/60 px-4 py-3">
                Camera and audio access are used only for features you explicitly start, such as
                verification, Test Lab, and live matches.
              </div>
              <div className="border border-zinc-800 bg-black/60 px-4 py-3">
                Anonymous sessions may be temporary, while registered accounts may retain profile
                and progression data needed to provide the service.
              </div>
              <div className="border border-zinc-800 bg-black/60 px-4 py-3">
                By continuing with consent, you allow the service to process personal data required
                to authenticate you, operate core features, prevent abuse, and improve reliability.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EntryChoiceModal({
  onAnonymous,
  onLogin,
  onRegister,
  isStartingVerification,
  verificationStartStatus,
  consentAccepted,
  onConsentChange,
  onOpenRules,
  onOpenPrivacy,
}: {
  onAnonymous: () => void;
  onLogin: () => void;
  onRegister: () => void;
  isStartingVerification: boolean;
  verificationStartStatus: string | null;
  consentAccepted: boolean;
  onConsentChange: (checked: boolean) => void;
  onOpenRules: () => void;
  onOpenPrivacy: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/78 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="entry-choice-title"
    >
      <div className="w-full max-w-xl border border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)]">
        <div className="border-b border-border px-5 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
            Welcome
          </div>
          <h2
            id="entry-choice-title"
            className="mt-2 text-lg font-black uppercase tracking-[0.14em] text-zinc-100"
          >
            Choose Entry
          </h2>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-3">
          <button
            type="button"
            onClick={onAnonymous}
            disabled={isStartingVerification || !consentAccepted}
            className="min-h-40 border border-zinc-900 bg-black/60 p-4 text-left transition-colors hover:border-purple-400 hover:bg-purple-950/24 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="text-sm font-black uppercase tracking-[0.14em] text-zinc-100">
              {isStartingVerification ? "Starting..." : "Anonymous"}
            </div>
            <p className="mt-3 text-xs leading-5 text-zinc-500">
              Continue without registration. Progress will not be saved.
            </p>
          </button>
          <button
            type="button"
            onClick={onLogin}
            className="min-h-40 border border-zinc-900 bg-black/60 p-4 text-left transition-colors hover:border-purple-400 hover:bg-purple-950/24"
          >
            <div className="text-sm font-black uppercase tracking-[0.14em] text-zinc-100">
              Login
            </div>
            <p className="mt-3 text-xs leading-5 text-zinc-500">
              Enter existing account and continue with saved profile.
            </p>
          </button>
          <button
            type="button"
            onClick={onRegister}
            className="min-h-40 border border-zinc-900 bg-black/60 p-4 text-left transition-colors hover:border-purple-400 hover:bg-purple-950/24"
          >
            <div className="text-sm font-black uppercase tracking-[0.14em] text-zinc-100">
              Register
            </div>
            <p className="mt-3 text-xs leading-5 text-zinc-500">
              Create account to keep rating, settings, and progression.
            </p>
          </button>
        </div>
        <div className="px-5 pb-5">
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
        </div>
        {verificationStartStatus && (
          <div className="px-5 pb-5">
            <div className="border border-zinc-800 bg-black/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              {verificationStartStatus}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function VerificationSuccessModal({ onContinue }: { onContinue: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/78 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="verification-success-title"
    >
      <div className="w-full max-w-md border border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)]">
        <div className="border-b border-border px-5 py-4">
          <h2
            id="verification-success-title"
            className="text-base font-black uppercase tracking-[0.14em] text-zinc-100"
          >
            Congratulations
          </h2>
        </div>
        <div className="space-y-4 p-5">
          <p className="text-sm text-zinc-300">
            You passed verification successfully.
          </p>
          <button
            type="button"
            onClick={onContinue}
            className="inline-flex h-10 w-full items-center justify-center border border-purple-500/50 bg-purple-950/35 text-[10px] font-semibold uppercase tracking-[0.14em] text-purple-100 transition-colors hover:border-purple-300 hover:text-white"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const ENTRY_SEEN_KEY = "chadchat_entry_seen_v1";
  const CONSENT_ACCEPTED_KEY = "chadchat_consent_accepted_v1";
  const RESULT_SOUND_ENABLED_KEY = "chadchat_result_sound_enabled_v1";
  const RESULT_SOUND_VOLUME_KEY = "chadchat_result_sound_volume_v1";
  const startButtonRef = useRef<HTMLDivElement>(null);
  const bentoGridRef = useRef<HTMLDivElement>(null);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
  const [isStartModesOpen, setIsStartModesOpen] = useState(false);
  const [isTestLabOpen, setIsTestLabOpen] = useState(false);
  const [isDuelOpen, setIsDuelOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authNickname, setAuthNickname] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [verificationSession, setVerificationSession] =
    useState<VerificationStartResponse | null>(null);
  const [verificationDetected, setVerificationDetected] = useState({
    blink: 0,
    left: 0,
    right: 0,
  });
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [verificationPurpose, setVerificationPurpose] = useState<
    "register" | "anonymous" | null
  >(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationSubmitting, setVerificationSubmitting] = useState(false);
  const [verificationStarting, setVerificationStarting] = useState(false);
  const [verificationStartStatus, setVerificationStartStatus] = useState<string | null>(null);
  const [verificationSuccessOpen, setVerificationSuccessOpen] = useState(false);
  const [verifiedToken, setVerifiedToken] = useState<string | null>(null);
  const [verifiedPurpose, setVerifiedPurpose] = useState<
    "register" | "anonymous" | null
  >(null);
  const [ratingProfile, setRatingProfile] = useState<RatingProfile | null>(null);
  const [statsSummary, setStatsSummary] = useState<StatsSummary | null>(null);
  const [statsPeriodData, setStatsPeriodData] = useState<
    Partial<Record<StatsPeriodKey, StatsPeriod>>
  >({});
  const [recentForm, setRecentForm] = useState<string[]>([]);
  const [queueInfo, setQueueInfo] = useState<QueueInfo | null>(null);
  const [ratingDataLoading, setRatingDataLoading] = useState(false);
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [resultSoundOptions, setResultSoundOptions] = useState<ResultSoundOption[]>([]);
  const [resultSoundLoading, setResultSoundLoading] = useState(false);
  const [backendDownMessage, setBackendDownMessage] = useState<string | null>(null);
  const [legalModal, setLegalModal] = useState<"rules" | "privacy" | null>(null);
  const [showEntryChoice, setShowEntryChoice] = useState(false);
  const [showAnonymousProgressPrompt, setShowAnonymousProgressPrompt] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [tokens, setTokens] = useState<AuthTokens | null>(null);
  const [me, setMe] = useState<AuthUser | null>(null);
  const [auraPulse, setAuraPulse] = useState(false);
  const [chatCustomization, setChatCustomization] = useState<ChatCustomization>(
    defaultChatCustomization,
  );
  const [gameCustomization, setGameCustomization] = useState<GameCustomization>(
    defaultGameCustomization,
  );
  const [resultSoundEnabled, setResultSoundEnabled] = useState(true);
  const [resultSoundVolume, setResultSoundVolume] = useState(0.8);
  const isAnonymousUser = Boolean(
    me?.is_anonymous || me?.type === "anonymous",
  );
  const currentNickname =
    (me?.nickname && String(me.nickname)) ||
    (isAnonymousUser ? "ANONYMOUS" : "GUEST");
  const statsSnapshot = buildStatsSnapshot(ratingProfile, statsSummary);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setConsentAccepted(window.localStorage.getItem(CONSENT_ACCEPTED_KEY) === "1");
    const storedSoundEnabled = window.localStorage.getItem(RESULT_SOUND_ENABLED_KEY);
    const storedSoundVolume = window.localStorage.getItem(RESULT_SOUND_VOLUME_KEY);
    if (storedSoundEnabled !== null) {
      setResultSoundEnabled(storedSoundEnabled === "1");
    }
    if (storedSoundVolume !== null) {
      const parsed = Number(storedSoundVolume);
      if (Number.isFinite(parsed)) {
        setResultSoundVolume(Math.max(0, Math.min(1, parsed)));
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncTokens = () => {
      const nextTokens = loadTokens();
      setTokens(nextTokens);
      if (!nextTokens) {
        setMe(null);
        setRatingProfile(null);
        setStatsSummary(null);
        setStatsPeriodData({});
        setRecentForm([]);
        setQueueInfo(null);
        setLeaderboardEntries([]);
      }
    };

    window.addEventListener(AUTH_TOKENS_CHANGED_EVENT, syncTokens as EventListener);
    return () => {
      window.removeEventListener(AUTH_TOKENS_CHANGED_EVENT, syncTokens as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CONSENT_ACCEPTED_KEY, consentAccepted ? "1" : "0");
  }, [consentAccepted]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(RESULT_SOUND_ENABLED_KEY, resultSoundEnabled ? "1" : "0");
  }, [resultSoundEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(RESULT_SOUND_VOLUME_KEY, String(resultSoundVolume));
  }, [resultSoundVolume]);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    const checkHealth = async () => {
      try {
        const result = await getApiHealth(controller.signal);
        if (!mounted) return;
        if (!result.httpOk || result.health?.ok === false || result.health?.status === "degraded") {
          setBackendDownMessage("Some backend services are unavailable right now. Please reload the page and try again.");
          return;
        }
        setBackendDownMessage(null);
      } catch {
        if (!mounted) return;
        setBackendDownMessage("The backend is not responding right now. Please reload the page and try again.");
      }
    };

    void checkHealth();
    const id = window.setInterval(() => {
      void checkHealth();
    }, 20000);

    return () => {
      mounted = false;
      controller.abort();
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initAuth = async () => {
      setAuthLoading(true);
      setAuthError(null);
      try {
        let activeTokens = loadTokens();
        if (!activeTokens) {
          const hasSeenEntry =
            typeof window !== "undefined" &&
            window.localStorage.getItem(ENTRY_SEEN_KEY) === "1";
          if (!cancelled) {
            setShowEntryChoice(!hasSeenEntry);
            setAuthLoading(false);
          }
          return;
        }

        let profile: AuthUser | null = null;
        try {
          profile = await getMe(activeTokens.accessToken);
        } catch {
          const refreshed = await authRefresh(activeTokens.refreshToken);
          activeTokens = refreshed.tokens;
          saveTokens(activeTokens);
          profile = refreshed.user ?? (await getMe(activeTokens.accessToken));
        }

        if (!cancelled) {
          setTokens(activeTokens);
          setMe(profile);
        }
      } catch (error) {
        if (!cancelled) {
          setAuthError(error instanceof Error ? error.message : "Auth error");
        }
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    };

    void initAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!tokens?.accessToken) {
      setRatingDataLoading(false);
      setRatingProfile(null);
      setStatsSummary(null);
      setStatsPeriodData({});
      setRecentForm([]);
      setQueueInfo(null);
      setLeaderboardEntries([]);
      setLeaderboardLoading(false);
      setResultSoundOptions([]);
      setResultSoundLoading(false);
      return;
    }

    let cancelled = false;

    const loadRatingData = async () => {
      setRatingDataLoading(true);
      setLeaderboardLoading(true);
      try {
        const [
          myRating,
          summary,
          todayPeriod,
          weekPeriod,
          seasonPeriod,
          recentFormData,
          queueInfoData,
          leaderboard,
        ] = await Promise.all([
          getMyRating(tokens.accessToken),
          getStatsSummary(tokens.accessToken),
          getStatsPeriod(tokens.accessToken, "today"),
          getStatsPeriod(tokens.accessToken, "week"),
          getStatsPeriod(tokens.accessToken, "season"),
          getRecentForm(tokens.accessToken, 5),
          getQueueInfo(tokens.accessToken),
          getLeaderboard(tokens.accessToken, 20),
        ]);
        if (cancelled) return;
        setRatingProfile(myRating);
        setStatsSummary(summary);
        setStatsPeriodData({
          today: todayPeriod ?? undefined,
          week: weekPeriod ?? undefined,
          season: seasonPeriod ?? undefined,
        });
        setRecentForm(recentFormData);
        setQueueInfo(queueInfoData);
        setLeaderboardEntries(leaderboard);
      } catch {
        if (cancelled) return;
        setRatingProfile(null);
        setStatsSummary(null);
        setStatsPeriodData({});
        setRecentForm([]);
        setQueueInfo(null);
        setLeaderboardEntries([]);
      } finally {
        if (!cancelled) {
          setRatingDataLoading(false);
          setLeaderboardLoading(false);
        }
      }
    };

    void loadRatingData();
    return () => {
      cancelled = true;
    };
  }, [tokens?.accessToken]);

  useEffect(() => {
    if (!tokens?.accessToken) {
      setResultSoundOptions([]);
      setResultSoundLoading(false);
      return;
    }

    let cancelled = false;

    const loadSounds = async () => {
      setResultSoundLoading(true);
      try {
        const sounds = await getResultSounds(tokens.accessToken);
        if (cancelled) return;
        setResultSoundOptions(sounds);
        const selected = sounds.find((sound) => sound.selected);
        if (selected) {
          setGameCustomization((current) => ({
            ...current,
            victorySound: selected.title,
          }));
        }
      } catch {
        if (cancelled) return;
        setResultSoundOptions([]);
      } finally {
        if (!cancelled) setResultSoundLoading(false);
      }
    };

    void loadSounds();
    return () => {
      cancelled = true;
    };
  }, [tokens?.accessToken]);

  const handleSelectResultSound = useCallback(
    async (sound: ResultSoundOption) => {
      if (!tokens?.accessToken || !sound.owned) return;
      try {
        const nextSounds = await selectResultSound(tokens.accessToken, sound.id);
        if (nextSounds) {
          setResultSoundOptions(nextSounds);
          const selected = nextSounds.find((item) => item.selected) ?? sound;
          setGameCustomization((current) => ({
            ...current,
            victorySound: selected.title,
          }));
          return;
        }
        setResultSoundOptions((current) =>
          current.map((item) => ({
            ...item,
            selected: item.id === sound.id,
          })),
        );
        setGameCustomization((current) => ({
          ...current,
          victorySound: sound.title,
        }));
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : "Failed to select result sound");
      }
    },
    [tokens?.accessToken],
  );

  useEffect(() => {
    if (!isStatsOpen && !isCustomizeOpen && !isStartModesOpen && !isTestLabOpen && !isDuelOpen && !isAuthOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isTestLabOpen) {
          return;
        }
        setIsStatsOpen(false);
        setIsCustomizeOpen(false);
        setIsStartModesOpen(false);
        setIsDuelOpen(false);
        setIsAuthOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isStatsOpen, isCustomizeOpen, isStartModesOpen, isTestLabOpen, isDuelOpen, isAuthOpen]);

  const completeRegisteredAuth = useCallback(async (verificationTokenValue?: string) => {
    const nickname = authNickname.trim();
    const password = authPassword.trim();
    if (!nickname || !password) {
      throw new Error("Nickname and password are required");
    }

    let result: { tokens: AuthTokens; user: AuthUser | null };
    if (isAnonymousUser && tokens) {
      result = await authUpgrade(tokens.accessToken, nickname, password);
    } else {
      if (!verificationTokenValue) {
        throw new Error("Complete webcam verification first");
      }
      result = await authRegister(nickname, password, verificationTokenValue);
    }

    saveTokens(result.tokens);
    setTokens(result.tokens);
    const profile = result.user ?? (await getMe(result.tokens.accessToken));
    setMe(profile);
    setAuthPassword("");
    setVerificationToken(null);
    setVerifiedToken(null);
    setVerifiedPurpose(null);
    setIsAuthOpen(false);
    setShowEntryChoice(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ENTRY_SEEN_KEY, "1");
    }
  }, [authNickname, authPassword, isAnonymousUser, tokens]);

  const handleAuthSubmit = async () => {
    if (authMode !== "login" && !consentAccepted) {
      setAuthError("Accept the rules, privacy policy, 18+ confirmation, and data processing terms");
      return;
    }

    const nickname = authNickname.trim();
    const password = authPassword.trim();
    if (!nickname || !password) {
      setAuthError("Nickname and password are required");
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    try {
      let result: { tokens: AuthTokens; user: AuthUser | null };
      if (authMode === "login") {
        result = await authLogin(nickname, password);
      } else {
        if (isAnonymousUser && tokens) {
          await completeRegisteredAuth();
          return;
        }
        if (!verifiedToken) {
          setAuthLoading(false);
          void handleStartVerification("register");
          return;
        }
        await completeRegisteredAuth(verifiedToken);
        return;
      }

      saveTokens(result.tokens);
      setTokens(result.tokens);
      const profile = result.user ?? (await getMe(result.tokens.accessToken));
      setMe(profile);
      setAuthPassword("");
      setVerificationToken(null);
      setVerifiedToken(null);
      setIsAuthOpen(false);
      setShowEntryChoice(false);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ENTRY_SEEN_KEY, "1");
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Auth failed");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleStartVerification = async (purpose: "register" | "anonymous") => {
    setVerificationError(null);
    setVerificationStarting(true);
    setVerificationStartStatus("Contacting verification service...");
    setVerifiedToken(null);
    setVerificationToken(null);
    setVerifiedPurpose(null);
    try {
      const session = await verificationStart();
      setVerificationStartStatus("Verification session created. Opening camera...");
      setVerificationPurpose(purpose);
      setVerificationDetected({ blink: 0, left: 0, right: 0 });
      setVerificationSession(session);
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "Verification start failed",
      );
      setVerificationStartStatus(null);
    } finally {
      setVerificationStarting(false);
    }
  };

  const handleSubmitVerification = async () => {
    if (!verificationSession) return;
    setVerificationSubmitting(true);
    setVerificationError(null);
    try {
      const token = await verificationSubmit({
        verification_session_id: verificationSession.verification_session_id,
        detected_blink_count: verificationDetected.blink,
        detected_turn_left: verificationDetected.left,
        detected_turn_right: verificationDetected.right,
      });
      setVerifiedToken(token);
      setVerificationToken(token);
      setVerifiedPurpose(verificationPurpose);
      setVerificationSession(null);
      setVerificationPurpose(null);
      setVerificationStartStatus(null);
      setVerificationSuccessOpen(true);
    } catch (error) {
      setVerificationError(
        error instanceof Error ? error.message : "Verification submit failed",
      );
    } finally {
      setVerificationSubmitting(false);
    }
  };

  const handleVerificationSuccessContinue = async () => {
    setVerificationSuccessOpen(false);
    if (!verifiedToken) return;

    if (verifiedPurpose === "anonymous") {
      setAuthLoading(true);
      setAuthError(null);
      try {
        const result = await authAnonymous(verifiedToken);
        saveTokens(result.tokens);
        setTokens(result.tokens);
        const profile = result.user ?? (await getMe(result.tokens.accessToken));
        setMe(profile);
        setShowEntryChoice(false);
        setVerificationToken(null);
        setVerifiedToken(null);
        setVerifiedPurpose(null);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(ENTRY_SEEN_KEY, "1");
        }
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : "Anonymous auth failed");
        setShowEntryChoice(true);
      } finally {
        setAuthLoading(false);
      }
      return;
    }

    if (verifiedPurpose === "register") {
      setAuthLoading(true);
      setAuthError(null);
      try {
        await completeRegisteredAuth(verifiedToken);
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : "Auth failed");
      } finally {
        setAuthLoading(false);
      }
    }
  };

  const handleLogout = async () => {
    if (!tokens) return;
    setAuthLoading(true);
    setAuthError(null);
    try {
      await authLogout(tokens.refreshToken);
      saveTokens(null);
      setTokens(null);
      setMe(null);
      setRatingDataLoading(false);
      setRatingProfile(null);
      setLeaderboardEntries([]);
      setShowEntryChoice(true);
      setAuthMode("login");
      setAuthNickname("");
      setAuthPassword("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Logout failed");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleContinueAnonymous = () => {
    if (!consentAccepted) return;
    setShowEntryChoice(false);
    void handleStartVerification("anonymous");
  };

  const handleAnonymousGameFinished = useCallback(() => {
    if (!isAnonymousUser) return;
    setShowAnonymousProgressPrompt(true);
  }, [isAnonymousUser]);

  const openAuthFromAnonymousPrompt = useCallback((mode: "login" | "register") => {
    setShowAnonymousProgressPrompt(false);
    setShowEntryChoice(false);
    setAuthError(null);
    setAuthMode(mode);
    setIsAuthOpen(true);
  }, []);

  const handleAnonymousNicknameClick = useCallback(() => {
    setShowEntryChoice(false);
    setShowAnonymousProgressPrompt(false);
    setAuthError(null);
    setAuthMode("register");
    setIsAuthOpen(true);
  }, []);

  const handleGuestNicknameClick = useCallback(() => {
    setShowAnonymousProgressPrompt(false);
    setAuthError(null);
    setShowEntryChoice(true);
    setIsAuthOpen(false);
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-auto absolute inset-0 opacity-55">
        <PixelBlast
          variant="square"
          pixelSize={4}
          color="#B497CF"
          patternScale={2}
          patternDensity={1}
          pixelSizeJitter={0}
          enableRipples
          rippleSpeed={0.4}
          rippleThickness={0.12}
          rippleIntensityScale={1.5}
          liquid={false}
          liquidStrength={0.12}
          liquidRadius={1.2}
          liquidWobbleSpeed={5}
          speed={0.5}
          edgeFade={0.25}
          transparent
        />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.32)_48%,rgba(0,0,0,0.82)_100%)]" />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
        <nav className="flex h-14 items-center justify-center border border-border bg-zinc-950/85 shadow-wire backdrop-blur-sm">
          <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center px-4 text-sm font-semibold uppercase tracking-[0.18em] text-zinc-400">
            <button
              type="button"
              className="inline-flex h-8 items-center gap-2 justify-self-start border border-zinc-700 bg-black/70 px-2.5 text-[10px] font-semibold tracking-[0.12em] text-zinc-300 transition-colors hover:border-purple-400/55 hover:text-zinc-100"
              aria-label="Guide for SUB5"
            >
              <CircleHelp className="h-3.5 w-3.5 text-purple-300" aria-hidden="true" />
              <span>Guide for SUB5</span>
            </button>
            <div className="grid grid-cols-[auto_auto_auto] items-center gap-7 justify-self-center">
              <a className="transition-colors hover:text-zinc-100" href="#community">
                Community
              </a>
              <Shuffle
                text="CHADCHAT"
                shuffleDirection="right"
                duration={0.35}
                animationMode="evenodd"
                shuffleTimes={1}
                ease="power3.out"
                stagger={0.03}
                threshold={0.1}
                triggerOnce
                triggerOnHover
                respectReducedMotion
                loop={false}
                loopDelay={0}
                tag="span"
                className="nav-logo text-zinc-100"
              />
              <a
                className="grid grid-cols-[auto_16px] items-center gap-2 transition-colors hover:text-zinc-100"
                href="#shop"
              >
                Shop
                <ShoppingBag className="h-4 w-4 text-zinc-600" aria-hidden="true" />
              </a>
            </div>
            <div
              className={cn(
                "flex h-8 items-center gap-2 justify-self-end border border-zinc-700 bg-black/70 px-2.5 text-zinc-200 transition-all",
                "shadow-[0_0_12px_rgba(132,0,255,0.08)]",
                auraPulse &&
                  "scale-[1.02] border-purple-300 shadow-[0_0_20px_rgba(168,85,247,0.28)]",
              )}
            >
              <button
                type="button"
                onClick={() => {
                  if (isAnonymousUser) {
                    handleAnonymousNicknameClick();
                    return;
                  }
                  if (!tokens) {
                    handleGuestNicknameClick();
                  }
                }}
                className="inline-flex h-5 items-center gap-1 border border-zinc-700 bg-zinc-900/60 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-300 transition-colors hover:border-purple-500/60 hover:text-zinc-100"
              >
                <User className="h-3 w-3" aria-hidden="true" />
                {authLoading ? "..." : currentNickname}
              </button>
              {!isAnonymousUser && (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex h-5 w-5 items-center justify-center border border-zinc-700 bg-zinc-900/60 text-zinc-400 transition-colors hover:border-red-500/60 hover:text-red-300"
                  aria-label="Logout"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
              <span className="grid h-4 w-4 place-items-center border border-purple-400/45 bg-purple-950/30 text-[9px] leading-none text-purple-200">
                <Gem className="h-2.5 w-2.5" aria-hidden="true" />
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                Aura
              </span>
              <span className="bg-purple-950/20 px-1.5 py-0.5 text-[12px] font-black tabular-nums tracking-[0.04em] text-zinc-100">
                {auraBalance.toLocaleString()}
              </span>
              <button
                className="grid h-5 w-5 place-items-center border border-purple-500/55 bg-purple-950/35 text-[12px] font-black leading-none text-purple-200 transition-colors hover:border-purple-300 hover:bg-purple-900/45 hover:text-white"
                onClick={() => {
                  setAuraPulse(true);
                  window.setTimeout(() => setAuraPulse(false), 220);
                }}
                type="button"
                aria-label="Top up aura"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </nav>

        <GlobalSpotlight
          gridRef={bentoGridRef}
          enabled
          spotlightRadius={400}
          glowColor={magicGlow}
        />
        <div
          ref={bentoGridRef}
          className="bento-section grid flex-1 gap-4 py-4 lg:grid-cols-[minmax(180px,1fr)_minmax(280px,420px)_minmax(180px,1fr)]"
        >
          <Panel title="Live Chat" icon={<MessageSquare className="h-4 w-4" />}>
            <LiveChat
              chatCustomization={chatCustomization}
              currentUserName={currentNickname}
              accessToken={tokens?.accessToken ?? null}
            />
          </Panel>

          <ParticleCard
            className={cn(
              magicBlockClass,
              "h-[calc(100vh-7.5rem)] min-h-[420px] overflow-hidden shadow-wire backdrop-blur-sm",
            )}
            particleCount={12}
            glowColor={magicGlow}
            enableTilt={false}
            enableMagnetism={false}
            clickEffect
          >
            <section className="flex h-full min-h-0 flex-col justify-center gap-4 border border-border bg-black/82 p-4 sm:p-6">
              <MagicButton className="h-72 w-full sm:h-80">
                <StatsPanel
                  onOpenDetails={() => setIsStatsOpen(true)}
                  stats={statsSnapshot}
                  loading={ratingDataLoading}
                />
              </MagicButton>
              <MagicButton className="h-20 w-full">
                <Button
                  size="wireMedium"
                  variant="outline"
                  className="h-full gap-3"
                  onClick={() => setIsCustomizeOpen(true)}
                >
                  <UserRoundCog className="h-5 w-5" aria-hidden="true" />
                  Customize
                </Button>
              </MagicButton>
              <div ref={startButtonRef} className="relative h-14 overflow-hidden">
                <div className={cn("h-full border p-[2px]", getGameFrameClass(gameCustomization.frame))}>
                  <MagicButton className="h-full w-full">
                    <Button
                      size="wireSmall"
                      className="h-full gap-3 bg-zinc-100 text-black hover:bg-white hover:text-black"
                      onClick={() => setIsStartModesOpen(true)}
                    >
                      Start Mogging
                    </Button>
                  </MagicButton>
                </div>
                <Crosshair
                  containerRef={startButtonRef}
                  color="#c084fc"
                  glowColor="#a855f7"
                />
              </div>
            </section>
          </ParticleCard>

          <Panel title="Tops" icon={<Trophy className="h-4 w-4" />}>
            <TopsLeaderboard
              entries={leaderboardEntries}
              loading={leaderboardLoading}
            />
          </Panel>
        </div>
      </div>
      {isStatsOpen && (
        <StatsModal
          onClose={() => setIsStatsOpen(false)}
          stats={statsSnapshot}
          periodApiData={statsPeriodData}
          recentForm={recentForm}
          queueInfo={queueInfo}
        />
      )}
      {isCustomizeOpen && (
        <CustomizeModal
          chatCustomization={chatCustomization}
          gameCustomization={gameCustomization}
          resultSoundOptions={resultSoundOptions}
          resultSoundLoading={resultSoundLoading}
          resultSoundVolume={resultSoundVolume}
          onChangeChatCustomization={(next) =>
            setChatCustomization((current) => ({ ...current, ...next }))
          }
          onChangeGameCustomization={(next) =>
            setGameCustomization((current) => ({ ...current, ...next }))
          }
          onChangeResultSoundVolume={setResultSoundVolume}
          onSelectResultSound={handleSelectResultSound}
          onClose={() => setIsCustomizeOpen(false)}
        />
      )}
      {isStartModesOpen && (
        <StartModesModal
          onClose={() => setIsStartModesOpen(false)}
          onOpenTestLab={() => setIsTestLabOpen(true)}
          onOpenDuel={() => setIsDuelOpen(true)}
        />
      )}
      {isTestLabOpen && (
        <TestLabModal
          accessToken={tokens?.accessToken ?? null}
          onClose={(completed) => {
            setIsTestLabOpen(false);
            if (completed) handleAnonymousGameFinished();
          }}
        />
      )}
      {isDuelOpen && (
        <DuelModal
          accessToken={tokens?.accessToken ?? null}
          myUserId={me?.id ? String(me.id) : null}
          resultSoundEnabled={resultSoundEnabled}
          resultSoundVolume={resultSoundVolume}
          onFinished={handleAnonymousGameFinished}
          onClose={() => setIsDuelOpen(false)}
        />
      )}
      {isAuthOpen && (
        <AuthModal
          mode={authMode}
          setMode={setAuthMode}
          nickname={authNickname}
          password={authPassword}
          onNickname={setAuthNickname}
          onPassword={setAuthPassword}
          onSubmit={handleAuthSubmit}
          onClose={() => {
            setIsAuthOpen(false);
            if (!tokens) setShowEntryChoice(true);
          }}
          isAnonymous={isAnonymousUser}
          isSubmitting={authLoading}
          error={authError}
          verificationToken={verificationToken}
          consentAccepted={consentAccepted}
          onConsentChange={setConsentAccepted}
          onOpenRules={() => setLegalModal("rules")}
          onOpenPrivacy={() => setLegalModal("privacy")}
        />
      )}
      {verificationSession && (
        <VerificationModal
          session={verificationSession}
          detected={verificationDetected}
          setDetected={setVerificationDetected}
          onSubmit={handleSubmitVerification}
          onClose={() => {
            if (!tokens && verificationPurpose === "anonymous") {
              setShowEntryChoice(true);
            }
            setVerificationSession(null);
            setVerificationPurpose(null);
            setVerificationStartStatus(null);
          }}
          isSubmitting={verificationSubmitting}
          error={verificationError}
        />
      )}
      {verificationStarting && !verificationSession && (
        <VerificationStartingModal status={verificationStartStatus} />
      )}
      {verificationSuccessOpen && (
        <VerificationSuccessModal
          onContinue={() => void handleVerificationSuccessContinue()}
        />
      )}
      {showEntryChoice && (
        <EntryChoiceModal
          onAnonymous={handleContinueAnonymous}
          onLogin={() => {
            setShowEntryChoice(false);
            setAuthMode("login");
            setAuthError(null);
            setIsAuthOpen(true);
          }}
          onRegister={() => {
            setShowEntryChoice(false);
            setAuthMode("register");
            setAuthError(null);
            setVerificationToken(null);
            setIsAuthOpen(true);
          }}
          isStartingVerification={verificationStarting}
          verificationStartStatus={verificationStartStatus}
          consentAccepted={consentAccepted}
          onConsentChange={setConsentAccepted}
          onOpenRules={() => setLegalModal("rules")}
          onOpenPrivacy={() => setLegalModal("privacy")}
        />
      )}
      {legalModal && (
        <LegalModal
          kind={legalModal}
          onClose={() => setLegalModal(null)}
        />
      )}
      {showAnonymousProgressPrompt && (
        <AnonymousProgressModal
          onLogin={() => openAuthFromAnonymousPrompt("login")}
          onRegister={() => openAuthFromAnonymousPrompt("register")}
          onClose={() => setShowAnonymousProgressPrompt(false)}
        />
      )}
      {backendDownMessage && (
        <BackendStatusModal
          message={backendDownMessage}
        />
      )}
    </main>
  );
}
