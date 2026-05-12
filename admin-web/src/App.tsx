import { useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Clipboard,
  Database,
  Eye,
  FileJson,
  Gauge,
  HeartPulse,
  ListFilter,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  UserRound,
  Users,
  Volume2,
  Wand2,
  XCircle,
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

type JsonRecord = Record<string, unknown>;
type Row = JsonRecord;

type Dataset = {
  title: string;
  endpoint: string;
  payload: unknown;
  loadedAt: string;
};

type Action = {
  label: string;
  endpoint: string;
  icon: React.ElementType;
  run: () => Promise<unknown>;
};

const tabs: Array<{ key: TabKey; label: string; icon: React.ElementType }> = [
  { key: "dashboard", label: "Dashboard", icon: Gauge },
  { key: "users", label: "Users", icon: Users },
  { key: "ratings", label: "Ratings", icon: Activity },
  { key: "matches", label: "Matches", icon: Shield },
  { key: "features", label: "Features", icon: MessageSquare },
  { key: "sounds", label: "Sounds", icon: Volume2 },
  { key: "system", label: "Health", icon: HeartPulse },
];

const tablePreferredKeys = [
  "id",
  "user_id",
  "match_id",
  "nickname",
  "type",
  "verified",
  "verification_status",
  "rank",
  "rating",
  "wins",
  "losses",
  "score",
  "status",
  "title",
  "owned",
  "selected",
  "created_at",
  "updated_at",
];

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function valueText(value: unknown) {
  if (value === null || value === undefined || value === "") return "0";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Intl.NumberFormat("en-US").format(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `${value.length} rows`;
  if (typeof value === "object") return "object";
  return String(value);
}

function compact(value: unknown, max = 44) {
  const text = valueText(value);
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function titleize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function findRows(payload: unknown): Row[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];

  const preferred = [
    "users",
    "matches",
    "leaderboard",
    "ratings",
    "history",
    "sessions",
    "messages",
    "sounds",
    "owners",
    "services",
    "items",
    "data",
  ];

  for (const key of preferred) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }

  for (const value of Object.values(payload)) {
    if (Array.isArray(value) && value.some(isRecord)) return value.filter(isRecord);
  }

  return [];
}

function collectMetrics(payload: unknown) {
  if (!isRecord(payload)) return [];

  const topLevel = Object.entries(payload)
    .filter(([, value]) => ["number", "string", "boolean"].includes(typeof value))
    .slice(0, 12);

  if (topLevel.length >= 3) return topLevel;

  const nested = Object.entries(payload)
    .flatMap(([group, value]) =>
      isRecord(value)
        ? Object.entries(value)
            .filter(([, nestedValue]) => ["number", "string", "boolean"].includes(typeof nestedValue))
            .map(([key, nestedValue]) => [`${group}.${key}`, nestedValue] as [string, unknown])
        : [],
    )
    .slice(0, 12);

  return [...topLevel, ...nested];
}

function extractCursor(payload: unknown) {
  if (!isRecord(payload)) return "";
  const value = payload.next_cursor ?? payload.cursor_next ?? payload.nextCursor ?? payload.cursor;
  return typeof value === "string" ? value : "";
}

function pickRowId(row: Row) {
  return (
    row.user_id ??
    row.userID ??
    row.id ??
    row.match_id ??
    row.matchID ??
    row.sound_id ??
    row.soundID ??
    row.session_id ??
    row.sessionID ??
    "row"
  );
}

function copyToClipboard(value: unknown) {
  if (typeof navigator === "undefined") return;
  void navigator.clipboard.writeText(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

function ShellPanel({
  title,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        "magic-bento-wire rounded-[8px] border border-[#2F293A] bg-[#120F17]/85 shadow-wire",
        "relative overflow-hidden before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_20%_0%,rgba(132,0,255,0.14),transparent_38%)]",
        className,
      )}
    >
      <header className="relative flex h-11 items-center justify-between border-b border-[#2F293A] px-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300">
          <Icon className="h-3.5 w-3.5 text-purple-300" />
          {title}
        </div>
      </header>
      <div className="relative p-4">{children}</div>
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
    <label className="block text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
      {label}
      <input
        className="mt-1 h-9 w-full rounded-[6px] border border-zinc-800 bg-black/35 px-2.5 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-purple-400/70"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function PrimaryButton({
  icon: Icon,
  children,
  onClick,
  disabled,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="flex h-10 items-center justify-center gap-2 rounded-[6px] border border-purple-400/50 bg-purple-500/15 px-3 text-sm font-semibold text-purple-100 transition hover:bg-purple-500/25 disabled:cursor-not-allowed disabled:opacity-50"
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

function GhostButton({
  icon: Icon,
  children,
  onClick,
  active,
  disabled,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={cx(
        "flex h-9 items-center gap-2 rounded-[6px] border px-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-cyan-300/50 bg-cyan-400/10 text-cyan-100"
          : "border-zinc-800 bg-black/25 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-900/70",
      )}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

function MetricsGrid({ payload }: { payload: unknown }) {
  const metrics = collectMetrics(payload);
  if (!metrics.length) return null;

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(([label, value]) => (
        <div key={label} className="rounded-[6px] border border-zinc-800 bg-black/25 p-3">
          <div className="truncate text-[10px] uppercase tracking-[0.08em] text-zinc-500">{titleize(label)}</div>
          <div className="mt-1 truncate text-lg font-semibold text-zinc-100">{compact(value, 26)}</div>
        </div>
      ))}
    </div>
  );
}

function DataTable({
  rows,
  selectedRow,
  onSelect,
}: {
  rows: Row[];
  selectedRow: Row | null;
  onSelect: (row: Row) => void;
}) {
  const columns = useMemo(() => {
    const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
    const sorted = [
      ...tablePreferredKeys.filter((key) => keys.includes(key)),
      ...keys.filter((key) => !tablePreferredKeys.includes(key)).slice(0, 8),
    ];
    return sorted.slice(0, 8);
  }, [rows]);

  if (!rows.length) {
    return (
      <div className="flex min-h-[260px] items-center justify-center rounded-[6px] border border-dashed border-zinc-800 bg-black/20 text-sm text-zinc-500">
        No table rows in this response
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[6px] border border-zinc-800">
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="sticky top-0 z-[1] bg-[#120F17] text-[11px] uppercase tracking-[0.08em] text-zinc-500">
            <tr>
              {columns.map((column) => (
                <th key={column} className="border-b border-zinc-800 px-3 py-2 font-medium">
                  {titleize(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const selected = selectedRow === row;
              return (
                <tr
                  key={`${String(pickRowId(row))}-${index}`}
                  className={cx(
                    "cursor-pointer border-b border-zinc-900 transition last:border-b-0",
                    selected ? "bg-purple-500/15" : "hover:bg-zinc-900/70",
                  )}
                  onClick={() => onSelect(row)}
                >
                  {columns.map((column) => (
                    <td key={column} className="max-w-[220px] px-3 py-2 text-zinc-300">
                      <span className="block truncate" title={valueText(row[column])}>
                        {compact(row[column])}
                      </span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DetailPanel({
  row,
  dataset,
  rawMode,
  onRawMode,
}: {
  row: Row | null;
  dataset: Dataset | null;
  rawMode: boolean;
  onRawMode: (value: boolean) => void;
}) {
  const content = row ?? dataset?.payload ?? { message: "No data loaded" };

  return (
    <ShellPanel title="Inspector" icon={Eye} className="xl:sticky xl:top-[92px]">
      <div className="mb-3 flex flex-wrap gap-2">
        <GhostButton icon={Database} active={!rawMode} onClick={() => onRawMode(false)}>
          Details
        </GhostButton>
        <GhostButton icon={FileJson} active={rawMode} onClick={() => onRawMode(true)}>
          JSON
        </GhostButton>
        <GhostButton icon={Clipboard} onClick={() => copyToClipboard(content)}>
          Copy
        </GhostButton>
      </div>

      {!rawMode && isRecord(content) ? (
        <div className="max-h-[680px] overflow-auto rounded-[6px] border border-zinc-800">
          {Object.entries(content).map(([key, value]) => (
            <div key={key} className="grid grid-cols-[140px_1fr] border-b border-zinc-900 last:border-b-0">
              <div className="bg-black/20 px-3 py-2 text-[11px] uppercase tracking-[0.08em] text-zinc-500">
                {titleize(key)}
              </div>
              <div className="min-w-0 px-3 py-2 text-sm text-zinc-200">
                {isRecord(value) || Array.isArray(value) ? (
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs leading-5 text-zinc-300">
                    {JSON.stringify(value, null, 2)}
                  </pre>
                ) : (
                  <span className="break-words">{valueText(value)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <pre className="max-h-[680px] overflow-auto rounded-[6px] border border-zinc-800 bg-black/35 p-3 text-xs leading-5 text-zinc-200">
          {JSON.stringify(content, null, 2)}
        </pre>
      )}
    </ShellPanel>
  );
}

export default function App() {
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [secret, setSecret] = useState(loadAdminSecret());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [selectedRow, setSelectedRow] = useState<Row | null>(null);
  const [rawMode, setRawMode] = useState(false);

  const [userID, setUserID] = useState("");
  const [matchID, setMatchID] = useState("");
  const [soundID, setSoundID] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [verified, setVerified] = useState("");
  const [limit, setLimit] = useState("50");
  const [cursor, setCursor] = useState("");
  const [period, setPeriod] = useState("today");
  const [grantUserID, setGrantUserID] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createAudioUrl, setCreateAudioUrl] = useState("");

  const runAction = async (action: Action) => {
    try {
      setLoading(true);
      setError("");
      const payload = await action.run();
      setDataset({
        title: action.label,
        endpoint: action.endpoint,
        payload,
        loadedAt: new Date().toLocaleTimeString(),
      });
      setSelectedRow(null);
      const nextCursor = extractCursor(payload);
      if (nextCursor) setCursor(nextCursor);
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
          label: "Dashboard Summary",
          endpoint: "GET /admin/dashboard/summary",
          icon: BarChart3,
          run: () => adminRequest("/admin/dashboard/summary", { secret }),
        },
      ],
      users: [
        {
          label: "Users Search",
          endpoint: "GET /admin/users",
          icon: Search,
          run: () =>
            adminRequest("/admin/users", {
              secret,
              query: { query, type, verified, limit, cursor },
            }),
        },
        {
          label: "User Card",
          endpoint: "GET /admin/users/{userID}",
          icon: UserRound,
          run: () => adminRequest(`/admin/users/${userID}`, { secret }),
        },
        {
          label: "User Matches",
          endpoint: "GET /admin/users/{userID}/matches",
          icon: Shield,
          run: () =>
            adminRequest(`/admin/users/${userID}/matches`, {
              secret,
              query: { limit, cursor },
            }),
        },
        {
          label: "User Rating History",
          endpoint: "GET /admin/users/{userID}/rating-history",
          icon: Activity,
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
          endpoint: "GET /admin/ratings/leaderboard",
          icon: BarChart3,
          run: () =>
            adminRequest("/admin/ratings/leaderboard", {
              secret,
              query: { limit, cursor },
            }),
        },
        {
          label: "User Rating",
          endpoint: "GET /admin/ratings/{userID}",
          icon: UserRound,
          run: () => adminRequest(`/admin/ratings/${userID}`, { secret }),
        },
        {
          label: "Rating History",
          endpoint: "GET /admin/ratings/{userID}/history",
          icon: Activity,
          run: () =>
            adminRequest(`/admin/ratings/${userID}/history`, {
              secret,
              query: { limit },
            }),
        },
      ],
      matches: [
        {
          label: "Matches",
          endpoint: "GET /admin/matches",
          icon: Shield,
          run: () =>
            adminRequest("/admin/matches", {
              secret,
              query: { limit, cursor },
            }),
        },
        {
          label: "Match Details",
          endpoint: "GET /admin/matches/{matchID}",
          icon: Eye,
          run: () => adminRequest(`/admin/matches/${matchID}`, { secret }),
        },
        {
          label: "Match Stats",
          endpoint: "GET /admin/matches/stats",
          icon: Gauge,
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
          endpoint: "GET /admin/verification/stats",
          icon: CheckCircle2,
          run: () => adminRequest("/admin/verification/stats", { secret }),
        },
        {
          label: "Verification Sessions",
          endpoint: "GET /admin/verification/sessions",
          icon: ListFilter,
          run: () =>
            adminRequest("/admin/verification/sessions", {
              secret,
              query: { limit },
            }),
        },
        {
          label: "Test-Lab Stats",
          endpoint: "GET /admin/test-lab/stats",
          icon: Sparkles,
          run: () => adminRequest("/admin/test-lab/stats", { secret }),
        },
        {
          label: "Test-Lab Sessions",
          endpoint: "GET /admin/test-lab/sessions",
          icon: ListFilter,
          run: () =>
            adminRequest("/admin/test-lab/sessions", {
              secret,
              query: { limit },
            }),
        },
        {
          label: "Chat Stats",
          endpoint: "GET /admin/chat/stats",
          icon: MessageSquare,
          run: () => adminRequest("/admin/chat/stats", { secret }),
        },
        {
          label: "Chat Messages",
          endpoint: "GET /admin/chat/messages",
          icon: MessageSquare,
          run: () =>
            adminRequest("/admin/chat/messages", {
              secret,
              query: { limit },
            }),
        },
      ],
      sounds: [
        {
          label: "Result Sounds",
          endpoint: "GET /admin/result-sounds",
          icon: Volume2,
          run: () => adminRequest("/admin/result-sounds", { secret }),
        },
        {
          label: "Sound Owners",
          endpoint: "GET /admin/result-sounds/{soundID}/owners",
          icon: Users,
          run: () => adminRequest(`/admin/result-sounds/${soundID}/owners`, { secret }),
        },
        {
          label: "Create Sound",
          endpoint: "POST /admin/result-sounds",
          icon: Plus,
          run: () =>
            adminRequest("/admin/result-sounds", {
              secret,
              method: "POST",
              body: { title: createTitle, audio_url: createAudioUrl },
            }),
        },
        {
          label: "Grant Sound",
          endpoint: "POST /admin/result-sounds/grant",
          icon: Wand2,
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
          endpoint: "GET /admin/system/health",
          icon: HeartPulse,
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

  const rows = useMemo(() => findRows(dataset?.payload), [dataset]);
  const currentActions = actionsByTab[tab];

  const selectRow = (row: Row) => {
    setSelectedRow(row);
    const nextUserID = row.user_id ?? row.userID ?? row.id;
    const nextMatchID = row.match_id ?? row.matchID;
    const nextSoundID = row.sound_id ?? row.soundID ?? row.id;

    if (nextUserID !== undefined && tab !== "matches" && tab !== "sounds") setUserID(String(nextUserID));
    if (nextMatchID !== undefined) setMatchID(String(nextMatchID));
    if (nextSoundID !== undefined && tab === "sounds") setSoundID(String(nextSoundID));
  };

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100">
      <div className="fixed inset-0 pointer-events-none bg-[linear-gradient(135deg,rgba(132,0,255,0.12),transparent_34%),linear-gradient(45deg,rgba(14,165,233,0.08),transparent_42%)]" />
      <header className="sticky top-0 z-20 border-b border-[#2F293A] bg-black/75 backdrop-blur">
        <div className="mx-auto flex max-w-[1680px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="font-['Press_Start_2P'] text-xs uppercase tracking-[0.18em] text-zinc-100">
              Chadchat Admin
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span>{dataset?.endpoint ?? "No endpoint loaded"}</span>
              {dataset?.loadedAt ? <span>Loaded {dataset.loadedAt}</span> : null}
              {loading ? <span className="text-purple-200">Loading</span> : null}
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row lg:max-w-[560px]">
            <input
              className="h-10 min-w-0 flex-1 rounded-[6px] border border-zinc-800 bg-black/45 px-3 text-sm outline-none focus:border-purple-400/70"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="ADMIN_API_SECRET"
            />
            <PrimaryButton
              icon={Shield}
              onClick={() => {
                saveAdminSecret(secret);
              }}
            >
              Save Secret
            </PrimaryButton>
          </div>
        </div>
      </header>

      <div className="relative mx-auto grid max-w-[1680px] gap-4 p-4 lg:grid-cols-[240px_1fr]">
        <aside className="lg:sticky lg:top-[92px] lg:h-[calc(100vh-112px)]">
          <ShellPanel title="Sections" icon={Database} className="h-full">
            <nav className="space-y-1">
              {tabs.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    className={cx(
                      "flex h-10 w-full items-center gap-2 rounded-[6px] border px-3 text-left text-sm transition",
                      tab === item.key
                        ? "border-purple-400/60 bg-purple-500/15 text-purple-100"
                        : "border-transparent text-zinc-300 hover:border-zinc-800 hover:bg-black/30",
                    )}
                    onClick={() => {
                      setTab(item.key);
                      setSelectedRow(null);
                    }}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </ShellPanel>
        </aside>

        <main className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_430px]">
          <div className="space-y-4">
            <ShellPanel title="Command Bar" icon={ListFilter}>
              <div className="grid gap-3 xl:grid-cols-[1fr_auto]">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <Field label="User ID" value={userID} onChange={setUserID} placeholder="user id" />
                  <Field label="Match ID" value={matchID} onChange={setMatchID} placeholder="match id" />
                  <Field label="Sound ID" value={soundID} onChange={setSoundID} placeholder="sound id" />
                  <Field label="Limit" value={limit} onChange={setLimit} placeholder="50" />
                  <label className="block text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
                    Period
                    <select
                      className="mt-1 h-9 w-full rounded-[6px] border border-zinc-800 bg-black/35 px-2.5 text-sm normal-case tracking-normal text-zinc-100 outline-none focus:border-purple-400/70"
                      value={period}
                      onChange={(event) => setPeriod(event.target.value)}
                    >
                      <option value="today">today</option>
                      <option value="week">week</option>
                      <option value="season">season</option>
                    </select>
                  </label>
                </div>
                <div className="flex items-end gap-2">
                  <GhostButton
                    icon={RefreshCw}
                    onClick={() => {
                      const first = currentActions[0];
                      if (first) void runAction(first);
                    }}
                    disabled={loading}
                  >
                    Refresh
                  </GhostButton>
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Search" value={query} onChange={setQuery} placeholder="nickname, id, email" />
                <Field label="Type" value={type} onChange={setType} placeholder="anonymous/user/admin" />
                <Field label="Verified" value={verified} onChange={setVerified} placeholder="true/false/status" />
                <Field label="Cursor" value={cursor} onChange={setCursor} placeholder="next cursor" />
              </div>
            </ShellPanel>

            <ShellPanel title="Actions" icon={Sparkles}>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {currentActions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.label}
                      className="group min-h-[78px] rounded-[6px] border border-zinc-800 bg-black/25 p-3 text-left transition hover:border-purple-400/60 hover:bg-purple-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => void runAction(action)}
                      disabled={loading}
                    >
                      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                        <Icon className="h-4 w-4 text-purple-300" />
                        {action.label}
                      </div>
                      <div className="mt-2 text-xs leading-4 text-zinc-500">{action.endpoint}</div>
                    </button>
                  );
                })}
              </div>
            </ShellPanel>

            {tab === "sounds" ? (
              <ShellPanel title="Sound Changes" icon={Wand2}>
                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="rounded-[6px] border border-zinc-800 bg-black/20 p-3">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-zinc-400">
                      Create Result Sound
                    </div>
                    <div className="grid gap-2">
                      <Field label="Title" value={createTitle} onChange={setCreateTitle} placeholder="sound title" />
                      <Field label="Audio URL" value={createAudioUrl} onChange={setCreateAudioUrl} placeholder="https://..." />
                      <PrimaryButton icon={Plus} onClick={() => void runAction(currentActions[2])} disabled={loading}>
                        Create
                      </PrimaryButton>
                    </div>
                  </div>
                  <div className="rounded-[6px] border border-zinc-800 bg-black/20 p-3">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-zinc-400">
                      Grant Ownership
                    </div>
                    <div className="grid gap-2">
                      <Field label="Sound ID" value={soundID} onChange={setSoundID} placeholder="sound id" />
                      <Field label="User ID" value={grantUserID} onChange={setGrantUserID} placeholder="user id" />
                      <PrimaryButton icon={Wand2} onClick={() => void runAction(currentActions[3])} disabled={loading}>
                        Grant
                      </PrimaryButton>
                    </div>
                  </div>
                </div>
              </ShellPanel>
            ) : null}

            {error ? (
              <div className="flex items-start gap-2 rounded-[8px] border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-100">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            ) : null}

            {dataset ? (
              <ShellPanel title={dataset.title} icon={Database}>
                <MetricsGrid payload={dataset.payload} />
                <div className={cx("mt-4", collectMetrics(dataset.payload).length ? "" : "mt-0")}>
                  <DataTable rows={rows} selectedRow={selectedRow} onSelect={selectRow} />
                </div>
              </ShellPanel>
            ) : (
              <ShellPanel title="Overview" icon={BarChart3}>
                <div className="grid gap-3 md:grid-cols-3">
                  {[
                    ["Dashboard", "Product metrics and activity summary"],
                    ["Users", "Search, inspect cards, review matches"],
                    ["Sounds", "Create sounds and grant ownership"],
                  ].map(([title, body]) => (
                    <div key={title} className="rounded-[6px] border border-zinc-800 bg-black/25 p-4">
                      <div className="text-sm font-semibold text-zinc-100">{title}</div>
                      <div className="mt-2 text-sm leading-5 text-zinc-500">{body}</div>
                    </div>
                  ))}
                </div>
              </ShellPanel>
            )}
          </div>

          <DetailPanel row={selectedRow} dataset={dataset} rawMode={rawMode} onRawMode={setRawMode} />
        </main>
      </div>
    </div>
  );
}
