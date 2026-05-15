import type { ChatStyleSnapshot } from "@/lib/liveChat";

export const statsByPeriod = {
  today: {
    label: "Today",
  },
  week: {
    label: "Week",
  },
  season: {
    label: "Season",
  },
};

export type StatsPeriodKey = keyof typeof statsByPeriod;

export type StatsSnapshot = {
  rank: string;
  nextRank: string;
  rating: number;
  rankFloor: number;
  nextRankRating: number;
  wins: number;
  streak: number;
  losses: number;
  winRate: number;
  peakRating: number;
  matches: number;
  avgGain: number;
  avgLoss: number;
  averageScore: number;
  progressPercent: number;
};

export type UiPeriodStats = {
  label: string;
  rating: number;
  peakRating: number;
  matches: number;
  wins: number;
  losses: number;
  winRate: number;
  averageScore: number;
  avgGain: number;
  avgLoss: number;
  ratingTrend: number;
  peakTrend: number;
  matchesTrend: number;
  winsTrend: number;
  lossesTrend: number;
  winRateTrend: number;
  averageScoreTrend: number;
  avgGainTrend: number;
  avgLossTrend: number;
};

export type ChatMessage = {
  id: number | string;
  userId?: string;
  role?: string;
  avatarUrl?: string;
  createdAt?: string;
  user: string;
  text: string;
  isDeleted?: boolean;
  chatStyle?: ChatStyleSnapshot | null;
  mine?: boolean;
  pending?: boolean;
};

export type ChatCustomization = {
  title: string;
  nameColor: string;
  textStyle: string;
  titleBorderColor: string;
  titleBorderShape: string;
};

export type GameCustomization = {
  frame: string;
  victorySound: string;
};

export type DuelResultSound = {
  id: string;
  title: string;
  audio_url: string;
};

export const defaultChatCustomization: ChatCustomization = {
  title: "RANKED",
  nameColor: "Purple",
  textStyle: "Sharp",
  titleBorderColor: "Purple",
  titleBorderShape: "Square",
};

export const defaultGameCustomization: GameCustomization = {
  frame: "Neon Grid",
  victorySound: "Pulse",
};

export const initialChatMessages: ChatMessage[] = [];

export const leaderboardPageSize = 6;
