const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

async function parseResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  let payload: unknown = text;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }
  return payload;
}

function getMessage(payload: unknown, status: number, fallback: string): string {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if (typeof p.message === "string") return p.message;
    if (typeof p.error === "string") return p.error;
    if (typeof p.detail === "string") return p.detail;
  }
  return fallback;
}

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    throw new Error(getMessage(payload, response.status, `Request failed: ${response.status}`));
  }

  return payload as T;
}

const ADMIN_SECRET_KEY = "admin_secret_key";

export function getAdminSecret(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ADMIN_SECRET_KEY);
}

export function setAdminSecret(secret: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ADMIN_SECRET_KEY, secret);
}

export function clearAdminSecret(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ADMIN_SECRET_KEY);
}

function adminHeaders(): Record<string, string> {
  const secret = getAdminSecret();
  const headers: Record<string, string> = {};
  if (secret) {
    headers["X-Admin-Secret"] = secret;
  }
  return headers;
}

// ─── Dashboard ───
export interface AdminDashboardSummary {
  total_users: number;
  total_registered: number;
  total_anonymous: number;
  verified_users: number;
  total_matches: number;
  matches_today: number;
  avg_rating: number;
  top_rating: number;
  total_chat_messages: number;
  chat_messages_today: number;
  test_lab_sessions: number;
  test_lab_sessions_today: number;
  total_result_sounds: number;
  total_sound_unlocks: number;
}

// ─── Users ───
export interface AdminUser {
  id: string;
  nickname: string;
  type: string;
  role: string;
  verification_status: string;
  created_at: string;
  updated_at: string;
  rating: number;
  peak_rating: number;
  rank: string;
  matches: number;
  wins: number;
  losses: number;
  selected_sound_id?: string;
  selected_sound_title?: string;
}

export interface AdminUserList {
  users: AdminUser[];
  next_cursor: string;
}

export interface AdminUserDetail {
  user: AdminUser;
}

// ─── Matches ───
export interface AdminMatchEntry {
  match_id: string;
  mode: string;
  started_at: string;
  finished_at?: string;
  player_a_id: string;
  player_a_nickname: string;
  player_a_rank: string;
  player_a_score: number;
  player_b_id: string;
  player_b_nickname: string;
  player_b_rank: string;
  player_b_score: number;
  result: string;
  winner_id?: string;
  rating_delta_a: number;
  rating_delta_b: number;
}

export interface AdminMatchList {
  matches: AdminMatchEntry[];
  next_cursor: string;
}

export interface AdminMatchDetailEntry {
  user_id: string;
  nickname: string;
  opponent_rank: string;
  score: number;
  rating_delta: number;
  result: string;
  started_at: string;
  finished_at?: string;
  mode: string;
}

export interface AdminMatchDetail {
  match: {
    match_id: string;
    entries: AdminMatchDetailEntry[];
  };
}

export interface AdminMatchStats {
  stats: {
    matches: number;
    draws: number;
    disconnect_finishes: number;
    average_score: number;
    average_duration_sec: number;
  };
}

// ─── Rating ───
export interface AdminRatingHistoryEntry {
  delta: number;
  old_rating: number;
  new_rating: number;
  reason: string;
  source_id: string;
  created_at: string;
}

export interface AdminRatingHistory {
  history: AdminRatingHistoryEntry[];
}

export interface AdminRatingEntry {
  position: number;
  user_id: string;
  nickname: string;
  rating: number;
  peak_rating: number;
  rank: string;
  updated_at: string;
}

export interface AdminLeaderboard {
  entries: AdminRatingEntry[];
  next_cursor: string;
}

export interface AdminUserRating {
  rating: {
    user_id: string;
    nickname: string;
    rating: number;
    peak_rating: number;
    rank: string;
    matches_played: number;
    created_at: string;
    updated_at: string;
  };
}

// ─── Verification ───
export interface AdminVerificationStats {
  stats: {
    total_sessions: number;
    completed_sessions: number;
    pass_rate: number;
    issued_tokens: number;
    used_tokens: number;
    token_consume_rate: number;
  };
}

export interface AdminVerificationSession {
  id: string;
  blink_count: number;
  turn_left: number;
  turn_right: number;
  expires_at: string;
  completed_at?: string;
  created_at: string;
}

export interface AdminVerificationSessionList {
  sessions: AdminVerificationSession[];
}

// ─── Test Lab ───
export interface AdminTestLabStats {
  stats: {
    total_sessions: number;
    sessions_today: number;
    total_samples: number;
    average_final_score: number;
    completion_rate: number;
  };
}

export interface AdminTestLabSession {
  id: string;
  room_id: string;
  owner_id: string;
  started_at: string;
  ends_at: string;
  finished_at?: string;
  final_average: number;
  samples_count: number;
}

export interface AdminTestLabSessionList {
  sessions: AdminTestLabSession[];
}

// ─── Chat ───
export interface AdminChatTopSender {
  user_id: string;
  nickname: string;
  messages: number;
}

export interface AdminChatStats {
  stats: {
    total_messages: number;
    messages_today: number;
    top_senders: AdminChatTopSender[];
  };
}

export interface AdminChatMessage {
  id: string;
  sender_id: string;
  sender_nickname: string;
  text: string;
  created_at: string;
}

export interface AdminChatMessageList {
  messages: AdminChatMessage[];
}

// ─── Result Sounds ───
export interface AdminResultSound {
  id: string;
  title: string;
  audio_url: string;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  owners_count: number;
  selected_count: number;
}

export interface AdminResultSoundList {
  sounds: AdminResultSound[];
}

export interface AdminSoundOwner {
  user_id: string;
  nickname: string;
  unlocked_at: string;
  source: string;
  selected: boolean;
}

export interface AdminSoundOwnerList {
  owners: AdminSoundOwner[];
}

// ─── System Health ───
export interface AdminServiceHealth {
  ok: boolean;
  status_code: number;
  error?: string;
}

export interface AdminSystemHealth {
  ok: boolean;
  services: Record<string, AdminServiceHealth>;
}

// ─── API Functions ───

export async function getAdminDashboardSummary(): Promise<{ summary: AdminDashboardSummary }> {
  return adminRequest("/admin/dashboard/summary", { headers: adminHeaders() });
}

export async function getAdminUsers(cursor = "", limit = 20, query = "", type = "", verified = ""): Promise<AdminUserList> {
  const params = new URLSearchParams({ limit: String(limit), cursor, query, type, verified });
  return adminRequest(`/admin/users?${params.toString()}`, { headers: adminHeaders() });
}

export async function getAdminUser(userID: string): Promise<AdminUserDetail> {
  return adminRequest(`/admin/users/${userID}`, { headers: adminHeaders() });
}

export async function setAdminUserRole(userID: string, role: string): Promise<AdminUserDetail> {
  return adminRequest(`/admin/users/${userID}/role`, {
    method: "POST",
    headers: { ...adminHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
}

export async function getAdminUserMatches(userID: string): Promise<{ matches: AdminMatchEntry[]; next_cursor: string }> {
  return adminRequest(`/admin/users/${userID}/matches`, { headers: adminHeaders() });
}

export async function getAdminUserRatingHistory(userID: string): Promise<AdminRatingHistory> {
  return adminRequest(`/admin/users/${userID}/rating-history`, { headers: adminHeaders() });
}

export async function getAdminLeaderboard(cursor = "", limit = 50): Promise<AdminLeaderboard> {
  const params = new URLSearchParams({ limit: String(limit), cursor });
  return adminRequest(`/admin/ratings/leaderboard?${params.toString()}`, { headers: adminHeaders() });
}

export async function getAdminUserRating(userID: string): Promise<AdminUserRating> {
  return adminRequest(`/admin/ratings/${userID}`, { headers: adminHeaders() });
}

export async function getAdminMatches(cursor = "", limit = 20): Promise<AdminMatchList> {
  const params = new URLSearchParams({ limit: String(limit), cursor });
  return adminRequest(`/admin/matches?${params.toString()}`, { headers: adminHeaders() });
}

export async function getAdminMatch(matchID: string): Promise<AdminMatchDetail> {
  return adminRequest(`/admin/matches/${matchID}`, { headers: adminHeaders() });
}

export async function getAdminMatchStats(period = ""): Promise<AdminMatchStats> {
  const params = period ? `?period=${period}` : "";
  return adminRequest(`/admin/matches/stats${params}`, { headers: adminHeaders() });
}

export async function getAdminVerificationStats(): Promise<AdminVerificationStats> {
  return adminRequest("/admin/verification/stats", { headers: adminHeaders() });
}

export async function getAdminVerificationSessions(limit = 50): Promise<AdminVerificationSessionList> {
  return adminRequest(`/admin/verification/sessions?limit=${limit}`, { headers: adminHeaders() });
}

export async function getAdminTestLabStats(): Promise<AdminTestLabStats> {
  return adminRequest("/admin/test-lab/stats", { headers: adminHeaders() });
}

export async function getAdminTestLabSessions(limit = 50): Promise<AdminTestLabSessionList> {
  return adminRequest(`/admin/test-lab/sessions?limit=${limit}`, { headers: adminHeaders() });
}

export async function getAdminChatStats(): Promise<AdminChatStats> {
  return adminRequest("/admin/chat/stats", { headers: adminHeaders() });
}

export async function getAdminChatMessages(limit = 100): Promise<AdminChatMessageList> {
  return adminRequest(`/admin/chat/messages?limit=${limit}`, { headers: adminHeaders() });
}

export async function getAdminResultSounds(): Promise<AdminResultSoundList> {
  return adminRequest("/admin/result-sounds", { headers: adminHeaders() });
}

export async function getAdminResultSoundOwners(soundID: string): Promise<AdminSoundOwnerList> {
  return adminRequest(`/admin/result-sounds/${soundID}/owners`, { headers: adminHeaders() });
}

export async function getAdminSystemHealth(): Promise<AdminSystemHealth> {
  return adminRequest("/admin/system/health", { headers: adminHeaders() });
}
