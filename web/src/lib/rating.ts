const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

type JsonRecord = Record<string, unknown>;

function getMessage(payload: unknown, status: number, fallback: string) {
  if (status === 429) return "Too many requests, please try again later";
  if (!payload || typeof payload !== "object") return fallback;
  const p = payload as JsonRecord;
  const raw = p.message ?? p.error ?? p.detail;
  if (raw === "rate_limited") return "Too many requests, please try again later";
  return typeof raw === "string" && raw.trim() ? raw : fallback;
}

async function request<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    throw new Error(getMessage(payload, response.status, `Request failed: ${response.status}`));
  }

  return payload as T;
}

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
  const payload = await request<{ rating?: RatingProfile }>("/rating/me", accessToken);
  return payload.rating ?? null;
}

export async function getUserRating(accessToken: string, userID: string) {
  const payload = await request<{ rating?: RatingProfile }>(`/rating/${userID}`, accessToken);
  return payload.rating ?? null;
}

export async function getLeaderboard(accessToken: string, limit = 20) {
  const normalizedLimit = Math.max(1, Math.min(100, limit));
  const payload = await request<{ entries?: LeaderboardEntry[] }>(
    `/leaderboard?limit=${normalizedLimit}`,
    accessToken,
  );
  return payload.entries ?? [];
}
