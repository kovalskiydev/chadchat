export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type AuthUser = {
  id?: string | number;
  nickname?: string;
  is_anonymous?: boolean;
  type?: string;
  role?: string;
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
const STORAGE_KEY = "chadchat_auth_tokens_v1";
export const AUTH_TOKENS_CHANGED_EVENT = "chadchat-auth-tokens-changed";

type JsonRecord = Record<string, unknown>;
let refreshInFlight: Promise<AuthTokens> | null = null;

function getMessage(payload: unknown, status: number, fallback: string) {
  if (status === 429) return "Too many requests, please try again later";
  if (!payload || typeof payload !== "object") return fallback;
  const p = payload as JsonRecord;
  const raw = p.message ?? p.error ?? p.detail;
  if (raw === "rate_limited") return "Too many requests, please try again later";
  return typeof raw === "string" && raw.trim() ? raw : fallback;
}

function getRawError(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as JsonRecord;
  const raw = p.message ?? p.error ?? p.detail;
  return typeof raw === "string" ? raw.trim() : "";
}

function isInvalidAccessToken(status: number, payload: unknown) {
  const raw = getRawError(payload).toLowerCase();
  return (
    status === 401 ||
    raw === "invalid_access_token" ||
    raw === "invalid access token" ||
    raw.includes("invalid_access_token") ||
    raw.includes("invalid access token")
  );
}

async function parseResponsePayload(response: Response) {
  const text = await response.text();
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = { message: text };
    }
  }
  return payload;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    throw new Error(getMessage(payload, response.status, `Request failed: ${response.status}`));
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
    window.dispatchEvent(new CustomEvent(AUTH_TOKENS_CHANGED_EVENT));
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  window.dispatchEvent(new CustomEvent(AUTH_TOKENS_CHANGED_EVENT));
}

async function refreshStoredTokens(refreshToken: string) {
  if (!refreshInFlight) {
    refreshInFlight = authRefresh(refreshToken)
      .then((result) => {
        saveTokens(result.tokens);
        return result.tokens;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }

  return refreshInFlight;
}

function withAuthorizationHeader(
  init: RequestInit | undefined,
  accessToken: string,
): RequestInit {
  return {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  };
}

export async function authorizedFetch(
  path: string,
  init?: RequestInit,
  fallbackAccessToken?: string | null,
): Promise<Response> {
  const storedTokens = loadTokens();
  const firstAccessToken = storedTokens?.accessToken ?? fallbackAccessToken;
  if (!firstAccessToken) {
    throw new Error("Not authenticated");
  }

  let response = await fetch(`${API_BASE}${path}`, withAuthorizationHeader(init, firstAccessToken));
  if (response.ok) {
    return response;
  }

  const firstPayload = await parseResponsePayload(response.clone());
  if (!isInvalidAccessToken(response.status, firstPayload) || !storedTokens?.refreshToken) {
    throw new Error(
      getMessage(firstPayload, response.status, `Request failed: ${response.status}`),
    );
  }

  let refreshedTokens: AuthTokens;
  try {
    refreshedTokens = await refreshStoredTokens(storedTokens.refreshToken);
  } catch (error) {
    saveTokens(null);
    throw error;
  }
  response = await fetch(
    `${API_BASE}${path}`,
    withAuthorizationHeader(init, refreshedTokens.accessToken),
  );
  if (response.ok) {
    return response;
  }

  const retryPayload = await parseResponsePayload(response.clone());
  throw new Error(
    getMessage(retryPayload, response.status, `Request failed: ${response.status}`),
  );
}

export async function authorizedRequest<T>(
  path: string,
  init?: RequestInit,
  fallbackAccessToken?: string | null,
): Promise<T> {
  const response = await authorizedFetch(path, init, fallbackAccessToken);
  const payload = await parseResponsePayload(response);
  return payload as T;
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
