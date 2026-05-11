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

async function request<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
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

export type TestLabRoom = {
  id?: string;
  room_id?: string;
  sessions?: unknown[];
  [key: string]: unknown;
};

export type TestLabSessionStartResponse = {
  id?: string;
  session_id?: string;
  duration_sec?: number;
  seconds_left?: number;
  [key: string]: unknown;
};

export type TestLabScanResponse = {
  last_score?: number;
  running_average?: number;
  final_average?: number;
  seconds_left?: number;
  samples_count?: number;
  is_finished?: boolean;
  [key: string]: unknown;
};

export async function createTestLabRoom(accessToken: string) {
  const payload = await request<JsonRecord>("/test-lab/rooms", accessToken, {
    method: "POST",
  });
  return (payload.room as TestLabRoom | undefined) ?? (payload as TestLabRoom);
}

export async function getTestLabRoom(accessToken: string, roomID: string) {
  const payload = await request<JsonRecord>(`/test-lab/rooms/${roomID}`, accessToken);
  return (payload.room as TestLabRoom | undefined) ?? (payload as TestLabRoom);
}

export async function startTestLabSession(
  accessToken: string,
  roomID: string,
  durationSec = 10,
) {
  return request<TestLabSessionStartResponse>(
    `/test-lab/rooms/${roomID}/sessions/start`,
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duration_sec: durationSec }),
    },
  );
}

export async function scanTestLabSession(
  accessToken: string,
  roomID: string,
  sessionID: string,
  imageBase64: string,
) {
  return request<TestLabScanResponse>(
    `/test-lab/rooms/${roomID}/sessions/${sessionID}/scan`,
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: imageBase64 }),
    },
  );
}

export async function getTestLabSession(
  accessToken: string,
  roomID: string,
  sessionID: string,
) {
  return request<TestLabScanResponse>(
    `/test-lab/rooms/${roomID}/sessions/${sessionID}`,
    accessToken,
  );
}
