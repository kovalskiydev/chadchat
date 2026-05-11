import { authorizedRequest } from "@/lib/auth";

type JsonRecord = Record<string, unknown>;

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
  const payload = await authorizedRequest<JsonRecord>("/test-lab/rooms", {
    method: "POST",
  }, accessToken);
  return (payload.room as TestLabRoom | undefined) ?? (payload as TestLabRoom);
}

export async function getTestLabRoom(accessToken: string, roomID: string) {
  const payload = await authorizedRequest<JsonRecord>(
    `/test-lab/rooms/${roomID}`,
    undefined,
    accessToken,
  );
  return (payload.room as TestLabRoom | undefined) ?? (payload as TestLabRoom);
}

export async function startTestLabSession(
  accessToken: string,
  roomID: string,
  durationSec = 10,
) {
  return authorizedRequest<TestLabSessionStartResponse>(
    `/test-lab/rooms/${roomID}/sessions/start`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duration_sec: durationSec }),
    },
    accessToken,
  );
}

export async function scanTestLabSession(
  accessToken: string,
  roomID: string,
  sessionID: string,
  imageBase64: string,
) {
  return authorizedRequest<TestLabScanResponse>(
    `/test-lab/rooms/${roomID}/sessions/${sessionID}/scan`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: imageBase64 }),
    },
    accessToken,
  );
}

export async function getTestLabSession(
  accessToken: string,
  roomID: string,
  sessionID: string,
) {
  return authorizedRequest<TestLabScanResponse>(
    `/test-lab/rooms/${roomID}/sessions/${sessionID}`,
    undefined,
    accessToken,
  );
}
