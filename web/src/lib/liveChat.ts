import { authorizedFetch, authorizedRequest } from "@/lib/auth";

type JsonRecord = Record<string, unknown>;

export type LiveChatMessage = {
  id?: string | number;
  sender_id?: string | number;
  sender_nickname?: string;
  sender_role?: string;
  sender_avatar_url?: string;
  avatar_url?: string;
  nickname?: string;
  user?: string;
  text: string;
  is_deleted?: boolean;
  created_at?: string;
  chat_style?: ChatStyleSnapshot | null;
};

export type ChatStyleSnapshot = {
  title?: {
    label?: string;
    frame?: string;
    frame_color?: string;
    shape?: string;
    color?: string;
    colors?: string[];
    animated?: boolean;
  } | null;
  nickname?: {
    color?: string;
    gradient?: string[];
    colors?: string[];
    animated?: boolean;
    font_weight?: number;
  } | null;
  text?: {
    style?: string;
    color?: string;
    animated?: boolean;
  } | null;
  avatar?: {
    url?: string;
    frame?: string;
    color?: string;
  } | null;
  badges?: Array<{
    id?: string;
    label?: string;
    icon_url?: string;
    color?: string;
  }>;
};

export async function getLiveChatHistory(accessToken: string, limit = 40) {
  const normalizedLimit = Math.max(1, Math.min(1000, limit));
  const payload = await authorizedRequest<JsonRecord>("/live-chat/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: normalizedLimit }),
  }, accessToken);
  const history =
    (payload.history as LiveChatMessage[] | undefined) ??
    (payload.messages as LiveChatMessage[] | undefined) ??
    [];
  return history;
}

export async function sendLiveChatMessage(accessToken: string, text: string) {
  return authorizedRequest<JsonRecord>("/live-chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }, accessToken);
}

export async function deleteLiveChatMessage(accessToken: string, messageID: string | number) {
  await authorizedRequest(
    `/live-chat/messages/${encodeURIComponent(String(messageID))}`,
    {
      method: "DELETE",
    },
    accessToken,
  );
}

export async function streamLiveChat(
  accessToken: string,
  onEvent: (event: string, data: unknown) => void,
  signal: AbortSignal,
) {
  const response = await authorizedFetch("/live-chat/stream", {
    method: "GET",
    headers: {
      Accept: "text/event-stream",
    },
    signal,
  }, accessToken);
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
