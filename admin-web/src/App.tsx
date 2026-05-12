import { useMemo, useState } from "react";
import { Activity, BarChart3, Shield, User, Users, Volume2 } from "lucide-react";

import { adminRequest, loadAdminSecret, saveAdminSecret } from "@/lib/api";

type Json = Record<string, unknown>;

const navItems = [
  { key: "dashboard", label: "Dashboard", icon: BarChart3 },
  { key: "users", label: "Users", icon: Users },
  { key: "ratings", label: "Ratings", icon: Activity },
  { key: "matches", label: "Matches", icon: Shield },
  { key: "features", label: "Verification/Test/Chat", icon: User },
  { key: "sounds", label: "Result Sounds", icon: Volume2 },
  { key: "system", label: "System Health", icon: Activity },
] as const;

type TabKey = (typeof navItems)[number]["key"];

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-none border border-border bg-zinc-950/70 shadow-wire">
      <header className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">
        {title}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function DataBlock({ data }: { data: unknown }) {
  return (
    <pre className="max-h-[520px] overflow-auto border border-border bg-black/40 p-3 text-xs leading-5 text-zinc-200">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

async function run<T>(
  exec: () => Promise<T>,
  setData: (value: T | null) => void,
  setError: (value: string) => void,
  setLoading: (value: boolean) => void,
) {
  try {
    setLoading(true);
    setError("");
    const payload = await exec();
    setData(payload);
  } catch (error) {
    setError(error instanceof Error ? error.message : "Unknown error");
  } finally {
    setLoading(false);
  }
}

export default function App() {
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [secret, setSecret] = useState(loadAdminSecret());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<unknown>(null);

  const [userID, setUserID] = useState("");
  const [matchID, setMatchID] = useState("");
  const [soundID, setSoundID] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [verified, setVerified] = useState("");
  const [limit, setLimit] = useState("20");
  const [cursor, setCursor] = useState("");
  const [period, setPeriod] = useState("today");

  const [grantUserID, setGrantUserID] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createAudioUrl, setCreateAudioUrl] = useState("");

  const headerActions = useMemo(
    () => [
      { label: "Summary", call: () => adminRequest("/admin/dashboard/summary", { secret }) },
      {
        label: "Users",
        call: () =>
          adminRequest("/admin/users", {
            secret,
            query: { query, type, verified, limit, cursor },
          }),
      },
      { label: "User by ID", call: () => adminRequest(`/admin/users/${userID}`, { secret }) },
      {
        label: "User Matches",
        call: () =>
          adminRequest(`/admin/users/${userID}/matches`, {
            secret,
            query: { limit, cursor },
          }),
      },
      {
        label: "User Rating History",
        call: () =>
          adminRequest(`/admin/users/${userID}/rating-history`, {
            secret,
            query: { limit },
          }),
      },
      {
        label: "Leaderboard",
        call: () => adminRequest("/admin/ratings/leaderboard", { secret, query: { limit, cursor } }),
      },
      { label: "Rating by User", call: () => adminRequest(`/admin/ratings/${userID}`, { secret }) },
      {
        label: "Rating History by User",
        call: () => adminRequest(`/admin/ratings/${userID}/history`, { secret, query: { limit } }),
      },
      {
        label: "Matches",
        call: () => adminRequest("/admin/matches", { secret, query: { limit, cursor } }),
      },
      { label: "Match by ID", call: () => adminRequest(`/admin/matches/${matchID}`, { secret }) },
      {
        label: "Match Stats",
        call: () => adminRequest("/admin/matches/stats", { secret, query: { period } }),
      },
      { label: "Verification Stats", call: () => adminRequest("/admin/verification/stats", { secret }) },
      {
        label: "Verification Sessions",
        call: () => adminRequest("/admin/verification/sessions", { secret, query: { limit } }),
      },
      { label: "Test-Lab Stats", call: () => adminRequest("/admin/test-lab/stats", { secret }) },
      {
        label: "Test-Lab Sessions",
        call: () => adminRequest("/admin/test-lab/sessions", { secret, query: { limit } }),
      },
      { label: "Chat Stats", call: () => adminRequest("/admin/chat/stats", { secret }) },
      {
        label: "Chat Messages",
        call: () => adminRequest("/admin/chat/messages", { secret, query: { limit } }),
      },
      { label: "Result Sounds", call: () => adminRequest("/admin/result-sounds", { secret }) },
      {
        label: "Sound Owners",
        call: () => adminRequest(`/admin/result-sounds/${soundID}/owners`, { secret }),
      },
      { label: "Health", call: () => adminRequest("/admin/system/health", { secret }) },
      {
        label: "Create Sound",
        call: () =>
          adminRequest("/admin/result-sounds", {
            secret,
            method: "POST",
            body: { title: createTitle, audio_url: createAudioUrl },
          }),
      },
      {
        label: "Grant Sound",
        call: () =>
          adminRequest("/admin/result-sounds/grant", {
            secret,
            method: "POST",
            body: { sound_id: soundID, user_id: grantUserID },
          }),
      },
    ],
    [
      createAudioUrl,
      createTitle,
      cursor,
      grantUserID,
      limit,
      matchID,
      period,
      query,
      secret,
      soundID,
      type,
      userID,
      verified,
    ],
  );

  const call = (label: string) => {
    const action = headerActions.find((item) => item.label === label);
    if (!action) return;
    run(action.call, setData, setError, setLoading);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,rgba(132,0,255,0.15),transparent_40%),radial-gradient(circle_at_left,rgba(56,189,248,0.08),transparent_45%),#050505] text-foreground">
      <header className="border-b border-border px-6 py-4">
        <h1 className="font-['Press_Start_2P'] text-sm tracking-[0.2em] text-zinc-100">CHADCHAT ADMIN PANEL</h1>
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-2 border border-border bg-zinc-950/70 p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={cx(
                  "flex w-full items-center gap-2 border px-3 py-2 text-left text-xs uppercase tracking-[0.14em]",
                  tab === item.key
                    ? "border-purple-400/60 bg-purple-500/10 text-purple-200"
                    : "border-border bg-black/20 text-zinc-300 hover:bg-zinc-900",
                )}
                onClick={() => setTab(item.key)}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </aside>

        <main className="space-y-4">
          <Card title="Auth">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <label className="flex-1 text-xs text-zinc-400">
                X-Admin-Secret
                <input
                  className="mt-1 w-full border border-border bg-black/30 px-2 py-2 text-sm text-zinc-100 outline-none focus:border-purple-400/70"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  placeholder="ADMIN_API_SECRET"
                />
              </label>
              <button
                className="border border-purple-400/60 bg-purple-500/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-purple-100"
                onClick={() => saveAdminSecret(secret)}
              >
                Save Secret
              </button>
            </div>
          </Card>

          <Card title="Filters">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <input className="border border-border bg-black/30 px-2 py-2 text-sm" placeholder="userID" value={userID} onChange={(e) => setUserID(e.target.value)} />
              <input className="border border-border bg-black/30 px-2 py-2 text-sm" placeholder="matchID" value={matchID} onChange={(e) => setMatchID(e.target.value)} />
              <input className="border border-border bg-black/30 px-2 py-2 text-sm" placeholder="soundID" value={soundID} onChange={(e) => setSoundID(e.target.value)} />
              <input className="border border-border bg-black/30 px-2 py-2 text-sm" placeholder="query" value={query} onChange={(e) => setQuery(e.target.value)} />
              <input className="border border-border bg-black/30 px-2 py-2 text-sm" placeholder="type" value={type} onChange={(e) => setType(e.target.value)} />
              <input className="border border-border bg-black/30 px-2 py-2 text-sm" placeholder="verified" value={verified} onChange={(e) => setVerified(e.target.value)} />
              <input className="border border-border bg-black/30 px-2 py-2 text-sm" placeholder="limit" value={limit} onChange={(e) => setLimit(e.target.value)} />
              <input className="border border-border bg-black/30 px-2 py-2 text-sm" placeholder="cursor" value={cursor} onChange={(e) => setCursor(e.target.value)} />
              <select className="border border-border bg-black/30 px-2 py-2 text-sm" value={period} onChange={(e) => setPeriod(e.target.value)}>
                <option value="today">today</option>
                <option value="week">week</option>
                <option value="season">season</option>
              </select>
              <input className="border border-border bg-black/30 px-2 py-2 text-sm" placeholder="grant userID" value={grantUserID} onChange={(e) => setGrantUserID(e.target.value)} />
              <input className="border border-border bg-black/30 px-2 py-2 text-sm" placeholder="new sound title" value={createTitle} onChange={(e) => setCreateTitle(e.target.value)} />
              <input className="border border-border bg-black/30 px-2 py-2 text-sm" placeholder="new sound audio_url" value={createAudioUrl} onChange={(e) => setCreateAudioUrl(e.target.value)} />
            </div>
          </Card>

          <Card title="Actions">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {(tab === "dashboard"
                ? ["Summary"]
                : tab === "users"
                  ? ["Users", "User by ID", "User Matches", "User Rating History"]
                  : tab === "ratings"
                    ? ["Leaderboard", "Rating by User", "Rating History by User"]
                    : tab === "matches"
                      ? ["Matches", "Match by ID", "Match Stats"]
                      : tab === "features"
                        ? [
                            "Verification Stats",
                            "Verification Sessions",
                            "Test-Lab Stats",
                            "Test-Lab Sessions",
                            "Chat Stats",
                            "Chat Messages",
                          ]
                        : tab === "sounds"
                          ? ["Result Sounds", "Sound Owners", "Create Sound", "Grant Sound"]
                          : ["Health"]
              ).map((label) => (
                <button
                  key={label}
                  className="border border-border bg-black/30 px-3 py-2 text-left text-xs uppercase tracking-[0.12em] text-zinc-200 hover:border-purple-400/60 hover:bg-purple-500/10"
                  onClick={() => call(label)}
                >
                  {label}
                </button>
              ))}
            </div>
          </Card>

          <Card title="Response">
            {loading && <div className="mb-3 text-xs uppercase tracking-[0.14em] text-zinc-400">Loading...</div>}
            {error ? <div className="mb-3 border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-200">{error}</div> : null}
            <DataBlock data={data ?? { message: "No data yet" }} />
          </Card>
        </main>
      </div>
    </div>
  );
}
