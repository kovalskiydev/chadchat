type Primitive = string | number | boolean | null | undefined;

type Query = Record<string, Primitive>;

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const ADMIN_SECRET_KEY = "chadchat_admin_secret_v1";

export function loadAdminSecret() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(ADMIN_SECRET_KEY) ?? "";
}

export function saveAdminSecret(secret: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ADMIN_SECRET_KEY, secret);
}

function toQueryString(query?: Query) {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

async function parsePayload(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function getError(payload: unknown, status: number) {
  if (!payload || typeof payload !== "object") return `Request failed: ${status}`;
  const p = payload as Record<string, unknown>;
  const message = p.message ?? p.error ?? p.detail;
  return typeof message === "string" && message.trim() ? message : `Request failed: ${status}`;
}

export async function adminRequest<T>(
  path: string,
  options?: {
    method?: "GET" | "POST";
    query?: Query;
    body?: unknown;
    secret?: string;
  },
): Promise<T> {
  const method = options?.method ?? "GET";
  const secret = options?.secret ?? loadAdminSecret();

  if (!secret) {
    throw new Error("Admin secret is required");
  }

  const response = await fetch(`${API_BASE}${path}${toQueryString(options?.query)}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Secret": secret,
    },
    body: method === "POST" ? JSON.stringify(options?.body ?? {}) : undefined,
  });

  const payload = await parsePayload(response);
  if (!response.ok) throw new Error(getError(payload, response.status));
  return payload as T;
}
