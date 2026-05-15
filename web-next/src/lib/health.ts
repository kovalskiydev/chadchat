const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export type HealthComponent = {
  ok: boolean;
  status_code?: number;
  error?: string;
};

export type ApiHealthResponse = {
  ok: boolean;
  status: "ok" | "degraded" | string;
  services?: Record<string, HealthComponent>;
};

export async function getApiHealth(signal?: AbortSignal) {
  const response = await fetch(`${API_BASE}/health`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });

  const text = await response.text();
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = { ok: false, status: "degraded" };
    }
  }

  return {
    httpOk: response.ok,
    httpStatus: response.status,
    health: payload as ApiHealthResponse,
  };
}
