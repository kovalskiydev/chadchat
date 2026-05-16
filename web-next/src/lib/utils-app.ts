import type {
  ChatCustomizationCatalog,
  ChatCustomizationSelection,
} from "@/lib/chatCustomization";
import type { ChatStyleSnapshot } from "@/lib/liveChat";
import type {
  RatingProfile,
  StatsPeriod,
  StatsSummary,
} from "@/lib/rating";
import type { Profile } from "@/lib/profile";
import type {
  StatsPeriodKey,
  StatsSnapshot,
  UiPeriodStats,
} from "@/types/app";
import { statsByPeriod, type DuelResultSound } from "@/types/app";
import type { TestLabRoom } from "@/lib/testLab";

// getAvatarInitials
export function getAvatarInitials(user: string) {
  return user
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 2)
    .toUpperCase();
}


// formatRankLabel
export function formatRankLabel(rank?: string | null) {
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


// buildStatsSnapshot
export function buildStatsSnapshot(
  ratingProfile: RatingProfile | null,
  statsSummary: StatsSummary | null,
): StatsSnapshot | null {
  if (statsSummary) {
    const rankFloor = statsSummary.rank_floor ?? 0;
    const nextRankRating = statsSummary.next_rank_rating ?? statsSummary.rating;
    const progressPercent =
      statsSummary.progress_percent ??
      Math.round(
        ((statsSummary.rating - rankFloor) /
          Math.max(1, nextRankRating - rankFloor)) *
          100,
      );

    return {
      rank: formatRankLabel(statsSummary.rank),
      nextRank: formatRankLabel(statsSummary.next_rank),
      rating: statsSummary.rating,
      rankFloor,
      nextRankRating,
      wins: statsSummary.wins,
      streak: statsSummary.streak,
      losses: statsSummary.losses,
      winRate: Math.round(statsSummary.win_rate),
      peakRating: statsSummary.peak_rating,
      matches: statsSummary.matches,
      avgGain: Math.round(statsSummary.avg_gain),
      avgLoss: Math.round(statsSummary.avg_loss),
      averageScore: Math.round(statsSummary.average_score),
      progressPercent,
    };
  }

  if (!ratingProfile) {
    return null;
  }

  const rankFloor = ratingProfile.rank_floor ?? 0;
  const nextRankRating = ratingProfile.next_rank_rating ?? ratingProfile.rating;
  const progressPercent =
    ratingProfile.progress_percent ??
    Math.round(
      ((ratingProfile.rating - rankFloor) / Math.max(1, nextRankRating - rankFloor)) * 100,
    );

  return {
    rank: formatRankLabel(ratingProfile.rank),
    nextRank: formatRankLabel(ratingProfile.next_rank),
    rating: ratingProfile.rating,
    rankFloor,
    nextRankRating,
    wins: 0,
    streak: 0,
    losses: 0,
    winRate: 0,
    peakRating: ratingProfile.peak_rating,
    matches: 0,
    avgGain: 0,
    avgLoss: 0,
    averageScore: 0,
    progressPercent,
  };
}


// buildPeriodStats
export function buildPeriodStats(
  statsSnapshot: StatsSnapshot,
  periodApiData: Partial<Record<StatsPeriodKey, StatsPeriod>>,
): Partial<Record<StatsPeriodKey, UiPeriodStats>> {
  const todayApi = periodApiData.today;
  const weekApi = periodApiData.week;
  const seasonApi = periodApiData.season;

  return {
    today: todayApi ? mapPeriodStats(statsSnapshot, "today", todayApi) : undefined,
    week: weekApi ? mapPeriodStats(statsSnapshot, "week", weekApi) : undefined,
    season: seasonApi ? mapPeriodStats(statsSnapshot, "season", seasonApi) : undefined,
  };
}


// mapPeriodStats
export function mapPeriodStats(
  statsSnapshot: StatsSnapshot,
  key: StatsPeriodKey,
  api: StatsPeriod,
): UiPeriodStats {
  return {
    label: statsByPeriod[key].label,
    rating: api.rating ?? statsSnapshot.rating,
    peakRating: api.peak_rating ?? statsSnapshot.peakRating,
    matches: api.matches,
    wins: api.wins,
    losses: api.losses,
    winRate: Math.round(api.win_rate),
    averageScore: Math.round(api.average_score),
    avgGain: Math.round(api.avg_gain),
    avgLoss: Math.round(api.avg_loss),
    ratingTrend: Math.round(api.rating_trend),
    peakTrend: Math.round(api.peak_trend),
    matchesTrend: Math.round(api.matches_trend),
    winsTrend: Math.round(api.wins_trend),
    lossesTrend: Math.round(api.losses_trend),
    winRateTrend: Math.round(api.win_rate_trend),
    averageScoreTrend: Math.round(api.average_score_trend),
    avgGainTrend: Math.round(api.avg_gain_trend),
    avgLossTrend: Math.round(api.avg_loss_trend),
  };
}


// getAvatarClass
export function getAvatarClass(user: string) {
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


// isAdminRole
export function isAdminRole(role?: string | null) {
  return role?.toLowerCase() === "admin";
}


// getNickColorClass
export function getNickColorClass(nameColor: string) {
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


// getChatTextClass
export function getChatTextClass(textStyle: string) {
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


// getInlineColorStyle
export function getInlineColorStyle(
  value?: { color?: string; gradient?: string[]; colors?: string[] } | null,
): React.CSSProperties | undefined {
  if (!value) return undefined;
  const colors = value.gradient ?? value.colors;
  if (Array.isArray(colors) && colors.length > 1) {
    return {
      backgroundImage: `linear-gradient(90deg, ${colors.join(", ")})`,
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
    };
  }
  if (value.color) return { color: value.color };
  return undefined;
}


// getChatStyleTextClass
export function getChatStyleTextClass(style?: string | null) {
  const normalized = (style ?? "").toLowerCase();
  if (normalized.includes("glitch")) return "font-semibold tracking-[0.08em] text-purple-200";
  if (normalized.includes("arcade")) return "font-black uppercase tracking-[0.1em] text-zinc-200";
  if (normalized.includes("minimal")) return "tracking-0 text-zinc-400";
  return "text-zinc-300";
}


// getChatStyleFrameClass
export function getChatStyleFrameClass(shape?: string | null, frame?: string | null) {
  const value = `${shape ?? ""} ${frame ?? ""}`.toLowerCase();
  if (value.includes("pill")) return "rounded-full";
  if (value.includes("round")) return "rounded-md";
  if (value.includes("double")) return "border-2";
  if (value.includes("dash")) return "border-dashed";
  return "";
}


// getSelectedChatStyle
export function getSelectedChatStyle(
  catalog: ChatCustomizationCatalog | null,
  selection: ChatCustomizationSelection | null,
): ChatStyleSnapshot | null {
  if (!catalog || !selection) return null;
  const title = catalog.titles.find((item) => item.id === selection.title_id);
  const nick = catalog.nickname_colors.find(
    (item) => item.id === selection.nickname_color_id,
  );
  const text = catalog.text_styles.find((item) => item.id === selection.text_style_id);
  const frame = catalog.title_frames.find((item) => item.id === selection.title_frame_id);
  const avatar = catalog.avatars.find((item) => item.id === selection.avatar_id);
  const badges = catalog.badges.filter((item) => selection.badge_ids?.includes(item.id));

  return {
    title: title
      ? {
          label: title.preview?.label ?? title.title,
          frame: frame?.preview?.frame ?? frame?.title,
          frame_color: frame?.preview?.frame_color ?? frame?.preview?.color,
          shape: frame?.preview?.shape ?? frame?.title,
          color: title.preview?.color,
          colors: title.preview?.colors ?? title.preview?.gradient,
          animated: Boolean(title.preview?.animated),
        }
      : null,
    nickname: nick
      ? {
          color: nick.preview?.color,
          gradient: nick.preview?.gradient ?? nick.preview?.colors,
          animated: Boolean(nick.preview?.animated),
          font_weight: 800,
        }
      : null,
    text: text
      ? {
          style: text.preview?.label ?? text.title,
          color: text.preview?.color,
          animated: Boolean(text.preview?.animated),
        }
      : null,
    avatar: avatar
      ? {
          url: avatar.preview?.url,
          frame: avatar.preview?.frame,
          color: avatar.preview?.color,
        }
      : null,
    badges: badges.map((badge) => ({
      id: badge.id,
      label: badge.preview?.label ?? badge.title,
      color: badge.preview?.color,
    })),
  };
}


// isAnimatedTitle
export function isAnimatedTitle(title: string) {
  return ["ELITE", "ASCENDED", "TRUE ADAM", "BLACKPILL", "VOIDKING"].includes(
    title,
  );
}


// getTitleBorderColorClass
export function getTitleBorderColorClass(color: string) {
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


// getTitleBorderShapeClass
export function getTitleBorderShapeClass(shape: string) {
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


// getGameFrameClass
export function getGameFrameClass(frame: string) {
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
      return "border-purple-400/75 bg-purple-950/30 shadow-[0_0_18px_rgba(132,0,255,0.22)]";
  }
}


// normalizeDuelResultSound
export function normalizeDuelResultSound(value: unknown): DuelResultSound | null {
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


// getRankClass
export function getRankClass(rank: string) {
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


// getTopClass
export function getTopClass(position: number) {
  if (position === 1) {
    return "border-zinc-800 bg-black/75";
  }
  if (position === 2) {
    return "border-zinc-800 bg-black/75";
  }
  if (position === 3) {
    return "border-zinc-800 bg-black/70";
  }
  return "border-zinc-900 bg-black/70";
}


// getTopAccentClass
export function getTopAccentClass(position: number) {
  if (position === 1) return "bg-[#d4af37]";
  if (position === 2) return "bg-[#c0c0c0]";
  if (position === 3) return "bg-[#cd7f32]";
  return "bg-transparent";
}


// getPositionClass
export function getPositionClass(position: number) {
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


// getTopGradientColors
export function getTopGradientColors(position: number) {
  if (position === 1) return ["#7a5a00", "#ffd86b", "#fff4b8"];
  if (position === 2) return ["#6f7680", "#f1f5f9", "#a8b0ba"];
  if (position === 3) return ["#7a3f16", "#f0a35b", "#ffd0a1"];
  return ["#e4e4e7", "#a1a1aa", "#f4f4f5"];
}


// getRoomID
export function getRoomID(room: TestLabRoom | null) {
  if (!room) return "";
  const direct = room.id ?? room.room_id;
  return direct ? String(direct) : "";
}


// formatScoreOutOfTen
export function formatScoreOutOfTen(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  const scaled = Math.max(0, Math.min(10, value * 2));
  const rounded = Math.round(scaled * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}/10`;
}


// formatProfileScore
export function formatProfileScore(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${Math.max(0, Math.min(10, value * 2)).toFixed(1)}/10`;
}


// formatDateShort
export function formatDateShort(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}


// profileTitleStyle
export function profileTitleStyle(profile: Profile | null): React.CSSProperties | undefined {
  const title = profile?.selected_title;
  if (!title) return undefined;
  if (Array.isArray(title.colors) && title.colors.length > 1) {
    return {
      backgroundImage: `linear-gradient(90deg, ${title.colors.join(", ")})`,
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
    };
  }
  return title.color ? { color: title.color } : undefined;
}

