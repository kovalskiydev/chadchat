import { authorizedRequest } from "@/lib/auth";

export type RatingProfile = {
  user_id: string;
  nickname: string;
  rating: number;
  peak_rating: number;
  rank: string;
  next_rank?: string;
  rank_floor?: number;
  next_rank_rating?: number;
  progress_percent?: number;
  created_at?: string;
  updated_at?: string;
};

export type LeaderboardEntry = {
  user_id: string;
  nickname: string;
  rating: number;
  peak_rating: number;
  rank: string;
  position?: number;
  updated_at?: string;
};

export type StatsSummary = {
  rating: number;
  peak_rating: number;
  rank: string;
  next_rank?: string;
  rank_floor?: number;
  next_rank_rating?: number;
  progress_percent?: number;
  wins: number;
  losses: number;
  matches: number;
  win_rate: number;
  average_score: number;
  avg_gain: number;
  avg_loss: number;
  streak: number;
};

export type StatsPeriod = StatsSummary & {
  rating_trend: number;
  peak_trend: number;
  matches_trend: number;
  wins_trend: number;
  losses_trend: number;
  win_rate_trend: number;
  average_score_trend: number;
  avg_gain_trend: number;
  avg_loss_trend: number;
};

export type RecentFormResponse = {
  results: string[];
};

export type QueueInfo = {
  queue_type?: string;
  estimated_wait_sec?: number;
  region?: string;
  last_match_rating_delta?: number;
};

export type MatchHistoryEntry = {
  match_id: string;
  mode?: string;
  started_at?: string;
  finished_at?: string;
  result?: "win" | "loss" | "draw" | string;
  rating_delta?: number;
  my_score?: number;
  opponent_score?: number;
  opponent_user_id?: string;
  opponent_nickname?: string;
  opponent_rank?: string;
};

export async function getMyRating(accessToken: string) {
  const payload = await authorizedRequest<{ rating?: RatingProfile }>(
    "/rating/me",
    undefined,
    accessToken,
  );
  return payload.rating ?? null;
}

export async function getUserRating(accessToken: string, userID: string) {
  const payload = await authorizedRequest<{ rating?: RatingProfile }>(
    `/rating/${userID}`,
    undefined,
    accessToken,
  );
  return payload.rating ?? null;
}

export async function getLeaderboard(accessToken: string, limit = 20) {
  const normalizedLimit = Math.max(1, Math.min(100, limit));
  const payload = await authorizedRequest<{ entries?: LeaderboardEntry[] }>(
    `/leaderboard?limit=${normalizedLimit}`,
    undefined,
    accessToken,
  );
  return payload.entries ?? [];
}

export async function getStatsSummary(accessToken: string) {
  const payload = await authorizedRequest<{ summary?: StatsSummary }>(
    "/stats/me/summary",
    undefined,
    accessToken,
  );
  return payload.summary ?? null;
}

export async function getStatsPeriod(
  accessToken: string,
  period: "today" | "week" | "season",
) {
  const payload = await authorizedRequest<{ period?: StatsPeriod }>(
    `/stats/me/period?period=${period}`,
    undefined,
    accessToken,
  );
  return payload.period ?? null;
}

export async function getRecentForm(accessToken: string, count = 5) {
  const normalizedCount = Math.max(1, Math.min(20, count));
  const payload = await authorizedRequest<RecentFormResponse>(
    `/stats/me/recent-form?count=${normalizedCount}`,
    undefined,
    accessToken,
  );
  return Array.isArray(payload.results) ? payload.results : [];
}

export async function getQueueInfo(accessToken: string) {
  const payload = await authorizedRequest<{ queue_info?: QueueInfo }>(
    "/stats/me/queue-info",
    undefined,
    accessToken,
  );
  return payload.queue_info ?? (payload as QueueInfo);
}

export async function getMyMatches(accessToken: string, limit = 20, cursor?: string) {
  const normalizedLimit = Math.max(1, Math.min(100, limit));
  const params = new URLSearchParams({ limit: String(normalizedLimit) });
  if (cursor) params.set("cursor", cursor);
  const payload = await authorizedRequest<{
    matches?: MatchHistoryEntry[];
    entries?: MatchHistoryEntry[];
    next_cursor?: string;
  }>(`/matches/me?${params.toString()}`, undefined, accessToken);

  return {
    matches: payload.matches ?? payload.entries ?? [],
    nextCursor: payload.next_cursor ?? null,
  };
}
