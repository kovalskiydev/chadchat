const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

type JsonRecord = Record<string, unknown>;

function getMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const p = payload as JsonRecord;
  const raw = p.message ?? p.error ?? p.detail;
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
    throw new Error(getMessage(payload, `Request failed: ${response.status}`));
  }
  return payload as T;
}

export type LiveChatMessage = {
  id?: string | number;
  sender_id?: string | number;
  sender_nickname?: string;
  nickname?: string;
  user?: string;
  text: string;
  created_at?: string;
};

export async function getLiveChatHistory(accessToken: string, limit = 40) {
  const normalizedLimit = Math.max(1, Math.min(1000, limit));
  const payload = await request<JsonRecord>("/live-chat/history", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: normalizedLimit }),
  });
  const history =
    (payload.history as LiveChatMessage[] | undefined) ??
    (payload.messages as LiveChatMessage[] | undefined) ??
    [];
  return history;
}

export async function sendLiveChatMessage(accessToken: string, text: string) {
  return request<JsonRecord>("/live-chat/messages", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export async function streamLiveChat(
  accessToken: string,
  onEvent: (event: string, data: unknown) => void,
  signal: AbortSignal,
) {
  const response = await fetch(`${API_BASE}/live-chat/stream`, {
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
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const lines = part.split("\n");
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
