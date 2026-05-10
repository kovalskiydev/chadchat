export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type AuthUser = {
  id?: string | number;
  nickname?: string;
  is_anonymous?: boolean;
  type?: string;
  verification_status?: string;
  [key: string]: unknown;
};

export type VerificationStartResponse = {
  verification_session_id: string;
  blink_count: number;
  turn_left: number;
  turn_right: number;
  expires_in_sec: number;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const STORAGE_KEY = "omoggle_auth_tokens_v1";

function getMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const p = payload as Record<string, unknown>;
  const raw = p.message ?? p.error ?? p.detail;
  return typeof raw === "string" && raw.trim() ? raw : fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
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
    throw new Error(getMessage(payload, `Request failed: ${response.status}`));
  }

  return payload as T;
}

function extractTokens(payload: unknown): AuthTokens {
  const p = payload as Record<string, unknown>;
  const accessToken =
    (p.access_token as string) ??
    (p.accessToken as string) ??
    ((p.tokens as Record<string, unknown> | undefined)?.access_token as string);
  const refreshToken =
    (p.refresh_token as string) ??
    (p.refreshToken as string) ??
    ((p.tokens as Record<string, unknown> | undefined)?.refresh_token as string);

  if (!accessToken || !refreshToken) {
    throw new Error("Invalid auth response: tokens are missing");
  }

  return { accessToken, refreshToken };
}

function extractUser(payload: unknown): AuthUser | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const direct =
    (p.user as AuthUser | undefined) ??
    (p.me as AuthUser | undefined) ??
    null;

  if (direct) return direct;

  if ("nickname" in p || "is_anonymous" in p) return p as AuthUser;
  return null;
}

export function loadTokens(): AuthTokens | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as AuthTokens;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: AuthTokens | null) {
  if (typeof window === "undefined") return;
  if (!tokens) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

export async function authAnonymous(verificationToken: string) {
  const payload = await request<Record<string, unknown>>("/auth/anonymous", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verification_token: verificationToken }),
  });
  return { tokens: extractTokens(payload), user: extractUser(payload) };
}

export async function authRegister(
  nickname: string,
  password: string,
  verificationToken: string,
) {
  const payload = await request<Record<string, unknown>>("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nickname,
      password,
      verification_token: verificationToken,
    }),
  });
  return { tokens: extractTokens(payload), user: extractUser(payload) };
}

export async function authLogin(nickname: string, password: string) {
  const payload = await request<Record<string, unknown>>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname, password }),
  });
  return { tokens: extractTokens(payload), user: extractUser(payload) };
}

export async function authUpgrade(
  accessToken: string,
  nickname: string,
  password: string,
) {
  const payload = await request<Record<string, unknown>>("/auth/upgrade", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ nickname, password }),
  });
  return { tokens: extractTokens(payload), user: extractUser(payload) };
}

export async function authRefresh(refreshToken: string) {
  const payload = await request<Record<string, unknown>>("/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  return { tokens: extractTokens(payload), user: extractUser(payload) };
}

export async function authLogout(refreshToken: string) {
  await request("/auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

export async function getMe(accessToken: string) {
  const payload = await request<Record<string, unknown>>("/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const nested = payload.user;
  if (nested && typeof nested === "object") {
    return nested as AuthUser;
  }
  return payload as AuthUser;
}

export async function verificationStart() {
  return request<VerificationStartResponse>("/verification/start", {
    method: "POST",
  });
}

export async function verificationSubmit(params: {
  verification_session_id: string;
  detected_blink_count: number;
  detected_turn_left: number;
  detected_turn_right: number;
}) {
  const payload = await request<Record<string, unknown>>("/verification/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const token = (payload.verification_token as string) ?? "";
  if (!token) throw new Error("Verification token missing");
  return token;
}
