import { useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  HeartPulse,
  MessageSquare,
  Search,
  Shield,
  User,
  Users,
  Volume2,
} from "lucide-react";

import { adminRequest, loadAdminSecret, saveAdminSecret } from "@/lib/api";

type TabKey =
  | "dashboard"
  | "users"
  | "ratings"
  | "matches"
  | "features"
  | "sounds"
  | "system";

type Action = {
  label: string;
  description: string;
  run: () => Promise<unknown>;
};

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/75 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">
      <header className="border-b border-zinc-800 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300">
        {title}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs text-zinc-400">
      {label}
      <input
        className="mt-1 w-full rounded-md border border-zinc-700 bg-black/30 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-sky-400/60"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
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

  const call = async (runAction: () => Promise<unknown>) => {
    try {
      setLoading(true);
      setError("");
      const payload = await runAction();
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const actionsByTab = useMemo<Record<TabKey, Action[]>>(
    () => ({
      dashboard: [
        {
          label: "Load Dashboard Summary",
          description: "Общая сводка по продукту",
          run: () => adminRequest("/admin/dashboard/summary", { secret }),
        },
      ],
      users: [
        {
          label: "Search Users",
          description: "Поиск + фильтры + пагинация",
          run: () =>
            adminRequest("/admin/users", {
              secret,
              query: { query, type, verified, limit, cursor },
            }),
        },
        {
          label: "Get User Card",
          description: "Карточка пользователя по userID",
          run: () => adminRequest(`/admin/users/${userID}`, { secret }),
        },
        {
          label: "Get User Matches",
          description: "Матчи пользователя",
          run: () =>
            adminRequest(`/admin/users/${userID}/matches`, {
              secret,
              query: { limit, cursor },
            }),
        },
        {
          label: "Get User Rating History",
          description: "История рейтинга пользователя",
          run: () =>
            adminRequest(`/admin/users/${userID}/rating-history`, {
              secret,
              query: { limit },
            }),
        },
      ],
      ratings: [
        {
          label: "Leaderboard",
          description: "Таблица лидеров",
          run: () =>
            adminRequest("/admin/ratings/leaderboard", {
              secret,
              query: { limit, cursor },
            }),
        },
        {
          label: "User Rating",
          description: "Текущий рейтинг по userID",
          run: () => adminRequest(`/admin/ratings/${userID}`, { secret }),
        },
        {
          label: "User Rating History",
          description: "История рейтинга по userID",
          run: () =>
            adminRequest(`/admin/ratings/${userID}/history`, {
              secret,
              query: { limit },
            }),
        },
      ],
      matches: [
        {
          label: "List Matches",
          description: "Список матчей",
          run: () =>
            adminRequest("/admin/matches", {
              secret,
              query: { limit, cursor },
            }),
        },
        {
          label: "Match Details",
          description: "Матч по matchID",
          run: () => adminRequest(`/admin/matches/${matchID}`, { secret }),
        },
        {
          label: "Match Stats",
          description: "Статистика матчей: today | week | season",
          run: () =>
            adminRequest("/admin/matches/stats", {
              secret,
              query: { period },
            }),
        },
      ],
      features: [
        {
          label: "Verification Stats",
          description: "Общая статистика верификации",
          run: () => adminRequest("/admin/verification/stats", { secret }),
        },
        {
          label: "Verification Sessions",
          description: "Последние сессии верификации",
          run: () =>
            adminRequest("/admin/verification/sessions", {
              secret,
              query: { limit },
            }),
        },
        {
          label: "Test-Lab Stats",
          description: "Сводка test-lab",
          run: () => adminRequest("/admin/test-lab/stats", { secret }),
        },
        {
          label: "Test-Lab Sessions",
          description: "Сессии test-lab",
          run: () =>
            adminRequest("/admin/test-lab/sessions", {
              secret,
              query: { limit },
            }),
        },
        {
          label: "Chat Stats",
          description: "Сводка по чату",
          run: () => adminRequest("/admin/chat/stats", { secret }),
        },
        {
          label: "Chat Messages",
          description: "Последние сообщения чата",
          run: () =>
            adminRequest("/admin/chat/messages", {
              secret,
              query: { limit },
            }),
        },
      ],
      sounds: [
        {
          label: "List Result Sounds",
          description: "Список звуков",
          run: () => adminRequest("/admin/result-sounds", { secret }),
        },
        {
          label: "Sound Owners",
          description: "Кому выдан soundID",
          run: () => adminRequest(`/admin/result-sounds/${soundID}/owners`, { secret }),
        },
        {
          label: "Create Sound (POST)",
          description: "Создать звук (title + audio_url)",
          run: () =>
            adminRequest("/admin/result-sounds", {
              secret,
              method: "POST",
              body: { title: createTitle, audio_url: createAudioUrl },
            }),
        },
        {
          label: "Grant Sound (POST)",
          description: "Выдать soundID пользователю",
          run: () =>
            adminRequest("/admin/result-sounds/grant", {
              secret,
              method: "POST",
              body: { sound_id: soundID, user_id: grantUserID },
            }),
        },
      ],
      system: [
        {
          label: "System Health",
          description: "Состояние сервисов",
          run: () => adminRequest("/admin/system/health", { secret }),
        },
      ],
    }),
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

  const tabs: Array<{ key: TabKey; label: string; icon: React.ElementType }> = [
    { key: "dashboard", label: "Dashboard", icon: BarChart3 },
    { key: "users", label: "Users", icon: Users },
    { key: "ratings", label: "Ratings", icon: Activity },
    { key: "matches", label: "Matches", icon: Shield },
    { key: "features", label: "Features", icon: MessageSquare },
    { key: "sounds", label: "Sounds", icon: Volume2 },
    { key: "system", label: "Health", icon: HeartPulse },
  ];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.16),transparent_38%),radial-gradient(circle_at_left,rgba(244,63,94,0.08),transparent_42%),#050505] text-zinc-100">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-black/60 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1500px] items-center justify-between px-4 py-3 md:px-6">
          <div>
            <h1 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-100">Chadchat Admin</h1>
            <p className="mt-1 text-xs text-zinc-500">Управление метриками, пользователями и сервисами</p>
          </div>
          <div className="w-full max-w-[420px]">
            <label className="block text-[11px] uppercase tracking-[0.1em] text-zinc-400">X-Admin-Secret</label>
            <div className="mt-1 flex gap-2">
              <input
                className="w-full rounded-md border border-zinc-700 bg-black/40 px-2.5 py-2 text-sm outline-none focus:border-sky-400/60"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                placeholder="ADMIN_API_SECRET"
              />
              <button
                className="rounded-md border border-sky-500/50 bg-sky-500/10 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-sky-200"
                onClick={() => saveAdminSecret(secret)}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1500px] gap-4 p-4 md:grid-cols-[220px_1fr] md:p-6">
        <aside className="h-fit rounded-lg border border-zinc-800 bg-zinc-950/75 p-2">
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={cx(
                  "mb-1 flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm",
                  tab === item.key
                    ? "border-sky-500/50 bg-sky-500/10 text-sky-200"
                    : "border-transparent text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900/70",
                )}
                onClick={() => setTab(item.key)}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </aside>

        <main className="grid gap-4 xl:grid-cols-[420px_1fr]">
          <div className="space-y-4">
            <Card title="Parameters">
              <div className="grid gap-3">
                <Field label="User ID" value={userID} onChange={setUserID} placeholder="Для user endpoints" />
                <Field label="Match ID" value={matchID} onChange={setMatchID} placeholder="Для /admin/matches/{id}" />
                <Field label="Sound ID" value={soundID} onChange={setSoundID} placeholder="Для sound owners / grant" />
                <Field label="Search Query" value={query} onChange={setQuery} placeholder="query" />
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Type" value={type} onChange={setType} placeholder="type" />
                  <Field label="Verified" value={verified} onChange={setVerified} placeholder="true/false" />
                  <Field label="Limit" value={limit} onChange={setLimit} placeholder="20" />
                </div>
                <Field label="Cursor" value={cursor} onChange={setCursor} placeholder="cursor" />

                <label className="block text-xs text-zinc-400">
                  Match Stats Period
                  <select
                    className="mt-1 w-full rounded-md border border-zinc-700 bg-black/30 px-2.5 py-2 text-sm"
                    value={period}
                    onChange={(event) => setPeriod(event.target.value)}
                  >
                    <option value="today">today</option>
                    <option value="week">week</option>
                    <option value="season">season</option>
                  </select>
                </label>

                <div className="rounded-md border border-zinc-800 bg-black/25 p-3">
                  <p className="mb-2 text-xs uppercase tracking-[0.1em] text-zinc-500">POST: Create Sound</p>
                  <div className="space-y-2">
                    <Field label="Title" value={createTitle} onChange={setCreateTitle} placeholder="sound title" />
                    <Field
                      label="Audio URL"
                      value={createAudioUrl}
                      onChange={setCreateAudioUrl}
                      placeholder="https://..."
                    />
                  </div>
                </div>

                <div className="rounded-md border border-zinc-800 bg-black/25 p-3">
                  <p className="mb-2 text-xs uppercase tracking-[0.1em] text-zinc-500">POST: Grant Sound</p>
                  <Field
                    label="Grant User ID"
                    value={grantUserID}
                    onChange={setGrantUserID}
                    placeholder="user id"
                  />
                </div>
              </div>
            </Card>

            <Card title="Actions">
              <div className="space-y-2">
                {actionsByTab[tab].map((action) => (
                  <button
                    key={action.label}
                    className="w-full rounded-md border border-zinc-700 bg-black/30 px-3 py-2 text-left transition hover:border-sky-500/60 hover:bg-sky-500/10"
                    onClick={() => call(action.run)}
                  >
                    <div className="text-sm font-medium text-zinc-100">{action.label}</div>
                    <div className="mt-1 text-xs text-zinc-500">{action.description}</div>
                  </button>
                ))}
              </div>
            </Card>
          </div>

          <Card title="Response Viewer">
            <div className="mb-3 flex items-center gap-2 text-xs text-zinc-400">
              <Search className="h-3.5 w-3.5" />
              <span>Последний ответ API в JSON</span>
            </div>
            {loading ? (
              <div className="mb-3 rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-300">Loading...</div>
            ) : null}
            {error ? (
              <div className="mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>
            ) : null}
            <pre className="max-h-[760px] overflow-auto rounded-md border border-zinc-800 bg-black/40 p-3 text-xs leading-5 text-zinc-200">
              {JSON.stringify(data ?? { message: "No requests yet" }, null, 2)}
            </pre>
          </Card>
        </main>
      </div>
    </div>
  );
}
