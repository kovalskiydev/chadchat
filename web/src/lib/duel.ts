const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

type JsonRecord = Record<string, unknown>;

function getMessage(payload: unknown, status: number, fallback: string) {
  if (status === 429) return "Слишком много запросов, попробуйте позже";
  if (!payload || typeof payload !== "object") return fallback;
  const p = payload as JsonRecord;
  const raw = p.message ?? p.error ?? p.detail;
  if (raw === "rate_limited") return "Слишком много запросов, попробуйте позже";
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

export type DuelMatch = {
  id?: string;
  match_id?: string;
  phase?: string;
  seconds_left?: number;
  my_avg?: number;
  opp_avg?: number;
  winner_id?: string;
  [key: string]: unknown;
};

export async function duelQueueJoin(accessToken: string) {
  return request<JsonRecord>("/duel/queue/join", accessToken, { method: "POST" });
}

export async function duelQueueLeave(accessToken: string) {
  return request<JsonRecord>("/duel/queue/leave", accessToken, { method: "POST" });
}

export async function duelCurrentMatch(accessToken: string) {
  return request<JsonRecord>("/duel/match/current", accessToken);
}

export async function duelGetMatch(accessToken: string, matchID: string) {
  return request<DuelMatch>(`/duel/match/${matchID}`, accessToken);
}

export async function duelScoreFrame(
  accessToken: string,
  matchID: string,
  imageBase64: string,
) {
  return request<JsonRecord>(`/duel/match/${matchID}/score-frame`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_base64: imageBase64 }),
  });
}

export async function duelSignal(
  accessToken: string,
  matchID: string,
  payload: Record<string, unknown>,
) {
  return request<JsonRecord>(`/duel/match/${matchID}/signal`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function duelStream(
  accessToken: string,
  matchID: string,
  onEvent: (event: string, data: unknown) => void,
  signal: AbortSignal,
) {
  const response = await fetch(`${API_BASE}/duel/match/${matchID}/stream`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "text/event-stream",
    },
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`SSE failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const lines = chunk.split("\n");
      let eventName = "message";
      let dataText = "";
      for (const line of lines) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        if (line.startsWith("data:")) dataText += `${line.slice(5).trim()}\n`;
      }
      const raw = dataText.trim();
      if (!raw) continue;
      let payload: unknown = raw;
      try {
        payload = JSON.parse(raw) as unknown;
      } catch {
        payload = { text: raw };
      }
      onEvent(eventName, payload);
    }
  }
}
