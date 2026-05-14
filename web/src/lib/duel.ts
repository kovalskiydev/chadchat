import { authorizedFetch, authorizedRequest } from "@/lib/auth";

type JsonRecord = Record<string, unknown>;

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

export type DuelRtcConfig = {
  ice_servers?: RTCIceServer[];
};

export async function duelRtcConfig(accessToken: string) {
  return authorizedRequest<DuelRtcConfig>("/duel/rtc-config", undefined, accessToken);
}

export async function duelQueueJoin(accessToken: string) {
  return authorizedRequest<JsonRecord>("/duel/queue/join", { method: "POST" }, accessToken);
}

export async function duelQueueLeave(accessToken: string) {
  return authorizedRequest<JsonRecord>("/duel/queue/leave", { method: "POST" }, accessToken);
}

export async function duelCurrentMatch(accessToken: string) {
  return authorizedRequest<JsonRecord>("/duel/match/current", undefined, accessToken);
}

export async function duelGetMatch(accessToken: string, matchID: string) {
  return authorizedRequest<DuelMatch>(`/duel/match/${matchID}`, undefined, accessToken);
}

export async function duelScoreFrame(
  accessToken: string,
  matchID: string,
  imageBase64: string,
) {
  return authorizedRequest<JsonRecord>(`/duel/match/${matchID}/score-frame`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_base64: imageBase64 }),
  }, accessToken);
}

export async function duelSignal(
  accessToken: string,
  matchID: string,
  payload: Record<string, unknown>,
) {
  return authorizedRequest<JsonRecord>(`/duel/match/${matchID}/signal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, accessToken);
}

export async function duelMediaReady(accessToken: string, matchID: string) {
  return authorizedRequest<JsonRecord>(`/duel/match/${matchID}/media-ready`, {
    method: "POST",
  }, accessToken);
}

export async function duelStream(
  accessToken: string,
  matchID: string,
  onEvent: (event: string, data: unknown) => void,
  signal: AbortSignal,
) {
  const response = await authorizedFetch(`/duel/match/${matchID}/stream`, {
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
