import { authorizedRequest } from "@/lib/auth";

type JsonRecord = Record<string, unknown>;

export type ResultSoundOption = {
  id: string;
  title: string;
  audio_url: string;
  is_default: boolean;
  owned: boolean;
  selected: boolean;
};

function normalizeSound(payload: JsonRecord): ResultSoundOption {
  return {
    id: String(payload.id ?? ""),
    title: String(payload.title ?? "Unknown Sound"),
    audio_url: String(payload.audio_url ?? ""),
    is_default: Boolean(payload.is_default),
    owned: Boolean(payload.owned),
    selected: Boolean(payload.selected),
  };
}

export async function getResultSounds(accessToken: string) {
  const payload = await authorizedRequest<{ sounds?: JsonRecord[] }>(
    "/result-sounds",
    undefined,
    accessToken,
  );
  return Array.isArray(payload.sounds)
    ? payload.sounds.map(normalizeSound).filter((sound) => sound.id)
    : [];
}

export async function selectResultSound(accessToken: string, soundID: string) {
  const payload = await authorizedRequest<{ sounds?: JsonRecord[] }>(
    "/result-sounds/select",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sound_id: soundID }),
    },
    accessToken,
  );

  if (Array.isArray(payload.sounds)) {
    return payload.sounds.map(normalizeSound).filter((sound) => sound.id);
  }

  return null;
}
