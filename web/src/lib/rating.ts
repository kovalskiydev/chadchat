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
