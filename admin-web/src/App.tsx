import { useMemo, useState } from "react";
import type { ElementType, ReactNode } from "react";
import {
  Activity,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Eye,
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

type SectionKey =
  | "overview"
  | "users"
  | "ratings"
  | "matches"
  | "activity"
  | "sounds"
  | "health";

type JsonRecord = Record<string, unknown>;
type Row = JsonRecord;

type Dataset = {
  title: string;
  payload: unknown;
  loadedAt: string;
  actionKey: string;
};

type Action = {
  key: string;
  title: string;
  hint: string;
  icon: ElementType;
  run: (pageToken: string) => Promise<unknown>;
};

const sections: Array<{ key: SectionKey; label: string; icon: ElementType }> = [
  { key: "overview", label: "Обзор", icon: Gauge },
  { key: "users", label: "Пользователи", icon: Users },
  { key: "ratings", label: "Рейтинг", icon: Activity },
  { key: "matches", label: "Матчи", icon: Shield },
  { key: "activity", label: "Активность", icon: MessageSquare },
  { key: "sounds", label: "Звуки", icon: Volume2 },
  { key: "health", label: "Сервисы", icon: HeartPulse },
];

const labels: Record<string, string> = {
  id: "ID",
  user_id: "Пользователь",
  userID: "Пользователь",
  match_id: "Матч",
  matchID: "Матч",
  nickname: "Ник",
  username: "Имя",
  email: "Почта",
  type: "Тип аккаунта",
  verified: "Проверка",
  verification_status: "Проверка",
  rank: "Ранг",
  rating: "Рейтинг",
  wins: "Победы",
  losses: "Поражения",
  score: "Счёт",
  status: "Статус",
  state: "Статус",
  title: "Название",
  audio_url: "Аудио",
  owned: "Владение",
  selected: "Выбран",
  created_at: "Создано",
  updated_at: "Обновлено",
  last_seen_at: "Был онлайн",
  response_time_ms: "Ответ, мс",
  service: "Сервис",
  name: "Название",
  message: "Сообщение",
  text: "Текст",
};

const preferredColumns = [
  "nickname",
  "user_id",
  "id",
  "type",
  "verified",
  "verification_status",
  "rating",
  "rank",
  "wins",
  "losses",
  "match_id",
  "score",
  "status",
  "title",
  "owned",
  "selected",
  "created_at",
];

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function labelFor(key: string) {
  return labels[key] ?? key.replace(/_/g, " ");
}

function readable(value: unknown) {
  if (value === null || value === undefined || value === "") return "нет данных";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (typeof value === "number") return Intl.NumberFormat("ru-RU").format(value);
  if (Array.isArray(value)) return `${value.length} записей`;
  if (typeof value === "object") return "подробнее";
  return String(value);
}

function short(value: unknown, max = 42) {
  const text = readable(value);
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function normalizeStatus(value: unknown) {
  const text = String(value ?? "").toLowerCase();
  if (["ok", "healthy", "active", "success", "ready", "verified", "true", "completed"].includes(text)) {
    return { label: "Работает", tone: "good" as const };
  }
  if (["pending", "waiting", "queued", "processing", "unknown"].includes(text)) {
    return { label: "Ожидание", tone: "wait" as const };
  }
  if (["false", "failed", "error", "down", "unhealthy", "blocked", "rejected"].includes(text)) {
    return { label: "Ошибка", tone: "bad" as const };
  }
  return { label: readable(value), tone: "neutral" as const };
}

function valueForSearch(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function findRows(payload: unknown): Row[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];

  const keys = [
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

  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }

  for (const value of Object.values(payload)) {
    if (Array.isArray(value) && value.some(isRecord)) return value.filter(isRecord);
  }

  return [];
}

function findNextPage(payload: unknown) {
  if (!isRecord(payload)) return "";
  const next = payload.next_cursor ?? payload.cursor_next ?? payload.nextCursor;
  return typeof next === "string" ? next : "";
}

function findMetrics(payload: unknown) {
  if (!isRecord(payload)) return [];

  const direct = Object.entries(payload)
    .filter(([, value]) => ["number", "string", "boolean"].includes(typeof value))
    .slice(0, 10);

  const nested = Object.entries(payload).flatMap(([group, value]) => {
    if (!isRecord(value)) return [];
    return Object.entries(value)
      .filter(([, item]) => ["number", "string", "boolean"].includes(typeof item))
      .map(([key, item]) => [`${labelFor(group)} · ${labelFor(key)}`, item] as [string, unknown]);
  });

  return [...direct, ...nested].slice(0, 10);
}

function numericMetrics(payload: unknown) {
  return findMetrics(payload)
    .filter(([, value]) => typeof value === "number")
    .map(([label, value]) => ({ label, value: Number(value) }))
    .slice(0, 8);
}

function pickId(row: Row, section: SectionKey) {
  if (section === "matches") return row.match_id ?? row.matchID ?? row.id;
  if (section === "sounds") return row.sound_id ?? row.soundID ?? row.id;
  return row.user_id ?? row.userID ?? row.id ?? row.match_id ?? row.matchID ?? row.sound_id ?? row.soundID;
}

function copy(value: unknown) {
  if (typeof navigator === "undefined") return;
  void navigator.clipboard.writeText(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

function Panel({
  title,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  icon: ElementType;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        "relative overflow-hidden rounded-[8px] border border-[#2F293A] bg-[#120F17]/85 shadow-wire",
        "before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_20%_0%,rgba(132,0,255,0.13),transparent_36%)]",
        className,
      )}
    >
      <header className="relative flex h-11 items-center justify-between border-b border-[#2F293A] px-4">
        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300">
          <Icon className="h-3.5 w-3.5 shrink-0 text-purple-300" />
          <span className="truncate">{title}</span>
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
        className="mt-1 h-9 w-full rounded-[6px] border border-zinc-800 bg-black/35 px-2.5 text-sm normal-case tracking-normal text-zinc-100 outline-none transition placeholder:text-zinc-700 focus:border-purple-400/70"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
      {label}
      <select
        className="mt-1 h-9 w-full rounded-[6px] border border-zinc-800 bg-black/35 px-2.5 text-sm normal-case tracking-normal text-zinc-100 outline-none focus:border-purple-400/70"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Button({
  icon: Icon,
  children,
  onClick,
  disabled,
  variant = "primary",
}: {
  icon: ElementType;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
}) {
  return (
    <button
      className={cx(
        "flex h-10 items-center justify-center gap-2 rounded-[6px] border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "border-purple-400/55 bg-purple-500/15 text-purple-100 hover:bg-purple-500/25",
        variant === "ghost" && "border-zinc-800 bg-black/25 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-900/70",
        variant === "danger" && "border-rose-400/50 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25",
      )}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

function StatusBadge({ value }: { value: unknown }) {
  const status = normalizeStatus(value);
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
        status.tone === "good" && "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
        status.tone === "wait" && "border-amber-300/40 bg-amber-400/10 text-amber-200",
        status.tone === "bad" && "border-rose-400/40 bg-rose-500/10 text-rose-200",
        status.tone === "neutral" && "border-zinc-700 bg-zinc-900 text-zinc-300",
      )}
    >
      <span
        className={cx(
          "h-1.5 w-1.5 rounded-full",
          status.tone === "good" && "bg-emerald-300",
          status.tone === "wait" && "bg-amber-300",
          status.tone === "bad" && "bg-rose-300",
          status.tone === "neutral" && "bg-zinc-500",
        )}
      />
      {status.label}
    </span>
  );
}

function MetricCards({ payload }: { payload: unknown }) {
  const metrics = findMetrics(payload);
  if (!metrics.length) return null;

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      {metrics.map(([key, value]) => (
        <div key={key} className="rounded-[6px] border border-zinc-800 bg-black/25 p-3">
          <div className="truncate text-[10px] uppercase tracking-[0.08em] text-zinc-500">{labelFor(key)}</div>
          <div className="mt-1 truncate text-lg font-semibold text-zinc-100">{short(value, 24)}</div>
        </div>
      ))}
    </div>
  );
}

function MiniChart({ payload, rows }: { payload: unknown; rows: Row[] }) {
  const metrics = numericMetrics(payload);
  const chartData =
    metrics.length > 1
      ? metrics
      : rows
          .slice(0, 8)
          .map((row, index) => ({
            label: String(row.nickname ?? row.title ?? row.rank ?? row.id ?? index + 1),
            value: Number(row.rating ?? row.score ?? row.wins ?? row.count ?? 0),
          }))
          .filter((item) => Number.isFinite(item.value) && item.value > 0);

  if (!chartData.length) return null;

  const max = Math.max(...chartData.map((item) => item.value), 1);

  return (
    <div className="mt-4 rounded-[6px] border border-zinc-800 bg-black/20 p-3">
      <div className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-zinc-400">График для быстрого анализа</div>
      <div className="space-y-2">
        {chartData.map((item) => (
          <div key={item.label} className="grid grid-cols-[120px_1fr_72px] items-center gap-2 text-xs">
            <div className="truncate text-zinc-500">{labelFor(item.label)}</div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-900">
              <div
                className="h-full rounded-full bg-gradient-to-r from-purple-400 to-cyan-300"
                style={{ width: `${Math.max(4, (item.value / max) * 100)}%` }}
              />
            </div>
            <div className="text-right tabular-nums text-zinc-300">{readable(item.value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SmartTable({
  rows,
  section,
  selected,
  onSelect,
}: {
  rows: Row[];
  section: SectionKey;
  selected: Row | null;
  onSelect: (row: Row) => void;
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const pageSize = 12;

  const columns = useMemo(() => {
    const all = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
    return [...preferredColumns.filter((key) => all.includes(key)), ...all.filter((key) => !preferredColumns.includes(key))].slice(0, 8);
  }, [rows]);

  const filteredRows = useMemo(() => {
    const searchText = search.trim().toLowerCase();
    const filtered = searchText
      ? rows.filter((row) => Object.values(row).some((value) => valueForSearch(value).toLowerCase().includes(searchText)))
      : rows;

    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const aValue = a[sortKey];
      const bValue = b[sortKey];
      const result =
        typeof aValue === "number" && typeof bValue === "number"
          ? aValue - bValue
          : readable(aValue).localeCompare(readable(bValue), "ru");
      return sortDirection === "asc" ? result : -result;
    });
  }, [rows, search, sortDirection, sortKey]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const visibleRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  const sortBy = (key: string) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("desc");
    }
  };

  if (!rows.length) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-[6px] border border-dashed border-zinc-800 bg-black/20 text-sm text-zinc-500">
        Здесь появятся данные после загрузки раздела
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block sm:w-[360px]">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-600" />
          <input
            className="h-9 w-full rounded-[6px] border border-zinc-800 bg-black/35 pl-9 pr-3 text-sm text-zinc-100 outline-none focus:border-purple-400/70"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Найти в таблице"
          />
        </label>
        <div className="text-xs text-zinc-500">
          Показано {visibleRows.length} из {filteredRows.length}
        </div>
      </div>

      <div className="overflow-hidden rounded-[6px] border border-zinc-800">
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead className="sticky top-0 z-[1] bg-[#120F17] text-[11px] uppercase tracking-[0.08em] text-zinc-500">
              <tr>
                {columns.map((column) => (
                  <th key={column} className="border-b border-zinc-800 px-3 py-2 font-medium">
                    <button className="flex items-center gap-1 hover:text-zinc-200" onClick={() => sortBy(column)}>
                      {labelFor(column)}
                      {sortKey === column ? (sortDirection === "asc" ? "↑" : "↓") : null}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => {
                const active = selected === row;
                return (
                  <tr
                    key={`${String(pickId(row, section) ?? "row")}-${index}`}
                    className={cx(
                      "cursor-pointer border-b border-zinc-900 transition last:border-b-0",
                      active ? "bg-purple-500/15" : "hover:bg-zinc-900/70",
                    )}
                    onClick={() => onSelect(row)}
                  >
                    {columns.map((column) => {
                      const value = row[column];
                      const isStatus = ["status", "state", "verified", "verification_status", "owned", "selected"].includes(column);
                      return (
                        <td key={column} className="max-w-[220px] px-3 py-2 text-zinc-300">
                          {isStatus ? (
                            <StatusBadge value={value} />
                          ) : (
                            <span className="block truncate" title={readable(value)}>
                              {short(value)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-zinc-500">
          Страница {page} из {pageCount}
        </div>
        <div className="flex gap-2">
          <Button icon={ChevronLeft} variant="ghost" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            Назад
          </Button>
          <Button
            icon={ChevronRight}
            variant="ghost"
            disabled={page >= pageCount}
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
          >
            Вперёд
          </Button>
        </div>
      </div>
    </div>
  );
}

function DetailCard({
  row,
  dataset,
  section,
}: {
  row: Row | null;
  dataset: Dataset | null;
  section: SectionKey;
}) {
  const [view, setView] = useState<"main" | "extra" | "raw">("main");
  const value = row ?? (isRecord(dataset?.payload) ? (dataset?.payload as JsonRecord) : null);

  return (
    <Panel title="Карточка" icon={Eye} className="xl:sticky xl:top-[92px]">
      <div className="mb-3 grid grid-cols-3 gap-2">
        <button
          className={cx("rounded-[6px] border px-2 py-2 text-xs", view === "main" ? "border-purple-400/60 bg-purple-500/15 text-purple-100" : "border-zinc-800 bg-black/25 text-zinc-400")}
          onClick={() => setView("main")}
        >
          Главное
        </button>
        <button
          className={cx("rounded-[6px] border px-2 py-2 text-xs", view === "extra" ? "border-purple-400/60 bg-purple-500/15 text-purple-100" : "border-zinc-800 bg-black/25 text-zinc-400")}
          onClick={() => setView("extra")}
        >
          Детали
        </button>
        <button
          className={cx("rounded-[6px] border px-2 py-2 text-xs", view === "raw" ? "border-purple-400/60 bg-purple-500/15 text-purple-100" : "border-zinc-800 bg-black/25 text-zinc-400")}
          onClick={() => setView("raw")}
        >
          Полные данные
        </button>
      </div>

      {!value ? (
        <div className="rounded-[6px] border border-dashed border-zinc-800 bg-black/20 p-4 text-sm text-zinc-500">
          Выберите строку в таблице, чтобы увидеть подробности.
        </div>
      ) : view === "raw" ? (
        <div>
          <Button icon={Clipboard} variant="ghost" onClick={() => copy(value)}>
            Скопировать
          </Button>
          <pre className="mt-3 max-h-[660px] overflow-auto rounded-[6px] border border-zinc-800 bg-black/35 p-3 text-xs leading-5 text-zinc-200">
            {JSON.stringify(value, null, 2)}
          </pre>
        </div>
      ) : (
        <div className="max-h-[720px] overflow-auto rounded-[6px] border border-zinc-800">
          {Object.entries(value)
            .filter(([, item]) => (view === "main" ? !isRecord(item) && !Array.isArray(item) : true))
            .map(([key, item]) => (
              <div key={key} className="grid grid-cols-[132px_1fr] border-b border-zinc-900 last:border-b-0">
                <div className="bg-black/20 px-3 py-2 text-[11px] uppercase tracking-[0.08em] text-zinc-500">
                  {labelFor(key)}
                </div>
                <div className="min-w-0 px-3 py-2 text-sm text-zinc-200">
                  {["status", "state", "verified", "verification_status", "owned", "selected"].includes(key) ? (
                    <StatusBadge value={item} />
                  ) : isRecord(item) || Array.isArray(item) ? (
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs leading-5 text-zinc-300">
                      {JSON.stringify(item, null, 2)}
                    </pre>
                  ) : (
                    <span className="break-words">{readable(item)}</span>
                  )}
                </div>
              </div>
            ))}
        </div>
      )}

      <div className="mt-3 rounded-[6px] border border-zinc-800 bg-black/20 p-3 text-xs leading-5 text-zinc-500">
        {section === "users" && "Клик по пользователю подставляет его ID для просмотра карточки, матчей и рейтинга."}
        {section === "matches" && "Клик по матчу подставляет ID матча для просмотра подробностей."}
        {section === "sounds" && "Клик по звуку подставляет ID звука для просмотра владельцев и выдачи пользователю."}
        {!["users", "matches", "sounds"].includes(section) && "Здесь отображаются детали выбранной записи или последнего загруженного отчёта."}
      </div>
    </Panel>
  );
}

function HealthGrid({ payload }: { payload: unknown }) {
  const rows = findRows(payload);
  if (!rows.length) return null;

  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((service, index) => (
        <div key={String(service.name ?? service.service ?? index)} className="rounded-[6px] border border-zinc-800 bg-black/25 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="truncate text-sm font-semibold text-zinc-100">{readable(service.name ?? service.service ?? service.id)}</div>
            <StatusBadge value={service.status ?? service.state ?? service.healthy ?? service.ok} />
          </div>
          <div className="grid gap-1 text-xs text-zinc-500">
            <div>Последний ответ: {readable(service.response_time_ms ?? service.latency_ms ?? service.response_time)}</div>
            <div>Проверено: {readable(service.checked_at ?? service.updated_at ?? service.last_seen_at)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [section, setSection] = useState<SectionKey>("overview");
  const [secret, setSecret] = useState(loadAdminSecret());
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [selectedRow, setSelectedRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nextPage, setNextPage] = useState("");

  const [userID, setUserID] = useState("");
  const [matchID, setMatchID] = useState("");
  const [soundID, setSoundID] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [accountType, setAccountType] = useState("");
  const [verified, setVerified] = useState("");
  const [limit, setLimit] = useState("50");
  const [period, setPeriod] = useState("today");
  const [grantUserID, setGrantUserID] = useState("");
  const [soundTitle, setSoundTitle] = useState("");
  const [soundUrl, setSoundUrl] = useState("");

  const execute = async (action: Action, loadMore = false) => {
    try {
      setLoading(true);
      setError("");
      const payload = await action.run(loadMore ? nextPage : "");
      setDataset({
        title: action.title,
        payload,
        actionKey: action.key,
        loadedAt: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
      });
      setSelectedRow(null);
      setNextPage(findNextPage(payload));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  };

  const actions = useMemo<Record<SectionKey, Action[]>>(
    () => ({
      overview: [
        {
          key: "summary",
          title: "Общий обзор",
          hint: "Главные показатели сайта",
          icon: BarChart3,
          run: () => adminRequest("/admin/dashboard/summary", { secret }),
        },
      ],
      users: [
        {
          key: "users",
          title: "Список пользователей",
          hint: "Поиск и фильтры по аккаунтам",
          icon: Search,
          run: (pageToken) =>
            adminRequest("/admin/users", {
              secret,
              query: { query: searchQuery, type: accountType, verified, limit, cursor: pageToken },
            }),
        },
        {
          key: "user-card",
          title: "Карточка пользователя",
          hint: "Подробности выбранного пользователя",
          icon: UserRound,
          run: () => adminRequest(`/admin/users/${userID}`, { secret }),
        },
        {
          key: "user-matches",
          title: "Матчи пользователя",
          hint: "История дуэлей выбранного пользователя",
          icon: Shield,
          run: (pageToken) => adminRequest(`/admin/users/${userID}/matches`, { secret, query: { limit, cursor: pageToken } }),
        },
        {
          key: "user-rating-history",
          title: "История рейтинга",
          hint: "Как менялся рейтинг пользователя",
          icon: Activity,
          run: () => adminRequest(`/admin/users/${userID}/rating-history`, { secret, query: { limit } }),
        },
      ],
      ratings: [
        {
          key: "leaderboard",
          title: "Таблица лидеров",
          hint: "Лучшие пользователи по рейтингу",
          icon: BarChart3,
          run: (pageToken) => adminRequest("/admin/ratings/leaderboard", { secret, query: { limit, cursor: pageToken } }),
        },
        {
          key: "rating",
          title: "Рейтинг пользователя",
          hint: "Текущий рейтинг выбранного пользователя",
          icon: UserRound,
          run: () => adminRequest(`/admin/ratings/${userID}`, { secret }),
        },
        {
          key: "rating-history",
          title: "История рейтинга",
          hint: "Изменения рейтинга выбранного пользователя",
          icon: Activity,
          run: () => adminRequest(`/admin/ratings/${userID}/history`, { secret, query: { limit } }),
        },
      ],
      matches: [
        {
          key: "matches",
          title: "Список матчей",
          hint: "Последние дуэли на сайте",
          icon: Shield,
          run: (pageToken) => adminRequest("/admin/matches", { secret, query: { limit, cursor: pageToken } }),
        },
        {
          key: "match",
          title: "Карточка матча",
          hint: "Подробности выбранного матча",
          icon: Eye,
          run: () => adminRequest(`/admin/matches/${matchID}`, { secret }),
        },
        {
          key: "match-stats",
          title: "Статистика матчей",
          hint: "Динамика за выбранный период",
          icon: Gauge,
          run: () => adminRequest("/admin/matches/stats", { secret, query: { period } }),
        },
      ],
      activity: [
        {
          key: "verification-stats",
          title: "Проверка профилей",
          hint: "Сколько пользователей проходит проверку",
          icon: CheckCircle2,
          run: () => adminRequest("/admin/verification/stats", { secret }),
        },
        {
          key: "verification-sessions",
          title: "Сессии проверки",
          hint: "Последние проверки пользователей",
          icon: ListFilter,
          run: () => adminRequest("/admin/verification/sessions", { secret, query: { limit } }),
        },
        {
          key: "test-lab-stats",
          title: "Test Lab",
          hint: "Активность в тестовой зоне",
          icon: Sparkles,
          run: () => adminRequest("/admin/test-lab/stats", { secret }),
        },
        {
          key: "test-lab-sessions",
          title: "Сессии Test Lab",
          hint: "Последние сессии тестов",
          icon: ListFilter,
          run: () => adminRequest("/admin/test-lab/sessions", { secret, query: { limit } }),
        },
        {
          key: "chat-stats",
          title: "Чат",
          hint: "Активность сообщений",
          icon: MessageSquare,
          run: () => adminRequest("/admin/chat/stats", { secret }),
        },
        {
          key: "chat-messages",
          title: "Сообщения",
          hint: "Последние сообщения чата",
          icon: MessageSquare,
          run: () => adminRequest("/admin/chat/messages", { secret, query: { limit } }),
        },
      ],
      sounds: [
        {
          key: "sounds",
          title: "Список звуков",
          hint: "Доступные звуки результата",
          icon: Volume2,
          run: () => adminRequest("/admin/result-sounds", { secret }),
        },
        {
          key: "owners",
          title: "Владельцы звука",
          hint: "Кому доступен выбранный звук",
          icon: Users,
          run: () => adminRequest(`/admin/result-sounds/${soundID}/owners`, { secret }),
        },
        {
          key: "create-sound",
          title: "Добавить звук",
          hint: "Создание нового звука результата",
          icon: Plus,
          run: () => adminRequest("/admin/result-sounds", { secret, method: "POST", body: { title: soundTitle, audio_url: soundUrl } }),
        },
        {
          key: "grant-sound",
          title: "Выдать звук",
          hint: "Дать пользователю доступ к звуку",
          icon: Wand2,
          run: () => adminRequest("/admin/result-sounds/grant", { secret, method: "POST", body: { sound_id: soundID, user_id: grantUserID } }),
        },
      ],
      health: [
        {
          key: "health",
          title: "Состояние сервисов",
          hint: "Что работает, а что требует внимания",
          icon: HeartPulse,
          run: () => adminRequest("/admin/system/health", { secret }),
        },
      ],
    }),
    [accountType, grantUserID, limit, matchID, period, searchQuery, secret, soundID, soundTitle, soundUrl, userID, verified],
  );

  const rows = useMemo(() => findRows(dataset?.payload), [dataset]);
  const currentActions = actions[section];

  const selectedAction = currentActions[0];

  const selectRow = (row: Row) => {
    setSelectedRow(row);
    const user = row.user_id ?? row.userID ?? row.id;
    const match = row.match_id ?? row.matchID;
    const sound = row.sound_id ?? row.soundID ?? row.id;
    if (section !== "matches" && section !== "sounds" && user !== undefined) setUserID(String(user));
    if (match !== undefined) setMatchID(String(match));
    if (section === "sounds" && sound !== undefined) setSoundID(String(sound));
  };

  const confirmCreateSound = () => {
    if (!soundTitle.trim() || !soundUrl.trim()) {
      setError("Заполните название звука и ссылку на аудио.");
      return;
    }
    if (window.confirm(`Добавить звук "${soundTitle}"?`)) void execute(actions.sounds[2]);
  };

  const confirmGrantSound = () => {
    if (!soundID.trim() || !grantUserID.trim()) {
      setError("Выберите звук и укажите пользователя.");
      return;
    }
    if (window.confirm(`Выдать звук ${soundID} пользователю ${grantUserID}?`)) void execute(actions.sounds[3]);
  };

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(135deg,rgba(132,0,255,0.12),transparent_34%),linear-gradient(45deg,rgba(14,165,233,0.08),transparent_42%)]" />

      <header className="sticky top-0 z-20 border-b border-[#2F293A] bg-black/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1680px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="font-['Press_Start_2P'] text-xs uppercase tracking-[0.18em] text-zinc-100">Chadchat Admin</div>
            <div className="mt-1 text-xs text-zinc-500">
              {dataset ? `${dataset.title} · обновлено ${dataset.loadedAt}` : "Выберите раздел и загрузите данные"}
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row lg:max-w-[600px]">
            <input
              className="h-10 min-w-0 flex-1 rounded-[6px] border border-zinc-800 bg-black/45 px-3 text-sm outline-none focus:border-purple-400/70"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="Секрет администратора"
            />
            <Button icon={Shield} onClick={() => saveAdminSecret(secret)}>
              Сохранить
            </Button>
          </div>
        </div>
      </header>

      <div className="relative mx-auto grid max-w-[1680px] gap-4 p-4 lg:grid-cols-[240px_1fr]">
        <aside className="lg:sticky lg:top-[92px] lg:h-[calc(100vh-112px)]">
          <Panel title="Разделы" icon={ListFilter} className="h-full">
            <nav className="space-y-1">
              {sections.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    className={cx(
                      "flex h-10 w-full items-center gap-2 rounded-[6px] border px-3 text-left text-sm transition",
                      section === item.key
                        ? "border-purple-400/60 bg-purple-500/15 text-purple-100"
                        : "border-transparent text-zinc-300 hover:border-zinc-800 hover:bg-black/30",
                    )}
                    onClick={() => {
                      setSection(item.key);
                      setSelectedRow(null);
                      setNextPage("");
                    }}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </Panel>
        </aside>

        <main className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_430px]">
          <div className="space-y-4">
            <Panel title="Фильтры" icon={ListFilter}>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <Field label="Поиск" value={searchQuery} onChange={setSearchQuery} placeholder="ник, ID, почта" />
                <SelectField
                  label="Тип аккаунта"
                  value={accountType}
                  onChange={setAccountType}
                  options={[
                    { value: "", label: "Все" },
                    { value: "anonymous", label: "Гость" },
                    { value: "registered", label: "Зарегистрирован" },
                    { value: "user", label: "Пользователь" },
                  ]}
                />
                <SelectField
                  label="Проверка"
                  value={verified}
                  onChange={setVerified}
                  options={[
                    { value: "", label: "Все" },
                    { value: "true", label: "Проверен" },
                    { value: "false", label: "Не проверен" },
                  ]}
                />
                <SelectField
                  label="Период"
                  value={period}
                  onChange={setPeriod}
                  options={[
                    { value: "today", label: "Сегодня" },
                    { value: "week", label: "Неделя" },
                    { value: "season", label: "Сезон" },
                  ]}
                />
                <SelectField
                  label="Сколько показать"
                  value={limit}
                  onChange={setLimit}
                  options={[
                    { value: "20", label: "20" },
                    { value: "50", label: "50" },
                    { value: "100", label: "100" },
                  ]}
                />
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <Field label="Пользователь" value={userID} onChange={setUserID} placeholder="выберите в таблице или введите ID" />
                <Field label="Матч" value={matchID} onChange={setMatchID} placeholder="выберите матч или введите ID" />
                <Field label="Звук" value={soundID} onChange={setSoundID} placeholder="выберите звук или введите ID" />
              </div>
            </Panel>

            <Panel title="Действия" icon={Sparkles}>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {currentActions
                  .filter((action) => !["create-sound", "grant-sound"].includes(action.key))
                  .map((action) => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={action.key}
                        className="min-h-[82px] rounded-[6px] border border-zinc-800 bg-black/25 p-3 text-left transition hover:border-purple-400/60 hover:bg-purple-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void execute(action)}
                        disabled={loading}
                      >
                        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                          <Icon className="h-4 w-4 text-purple-300" />
                          {action.title}
                        </div>
                        <div className="mt-2 text-xs leading-4 text-zinc-500">{action.hint}</div>
                      </button>
                    );
                  })}
              </div>
            </Panel>

            {section === "sounds" ? (
              <Panel title="Изменить звуки" icon={Wand2}>
                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="rounded-[6px] border border-zinc-800 bg-black/20 p-3">
                    <div className="mb-3 text-sm font-semibold text-zinc-100">Добавить новый звук</div>
                    <div className="grid gap-2">
                      <Field label="Название" value={soundTitle} onChange={setSoundTitle} placeholder="например: Victory Pulse" />
                      <Field label="Ссылка на аудио" value={soundUrl} onChange={setSoundUrl} placeholder="https://..." />
                      <Button icon={Plus} onClick={confirmCreateSound} disabled={loading}>
                        Добавить звук
                      </Button>
                    </div>
                  </div>
                  <div className="rounded-[6px] border border-zinc-800 bg-black/20 p-3">
                    <div className="mb-3 text-sm font-semibold text-zinc-100">Выдать звук пользователю</div>
                    <div className="grid gap-2">
                      <Field label="Звук" value={soundID} onChange={setSoundID} placeholder="выберите звук в таблице" />
                      <Field label="Пользователь" value={grantUserID} onChange={setGrantUserID} placeholder="ID пользователя" />
                      <Button icon={Wand2} onClick={confirmGrantSound} disabled={loading}>
                        Выдать звук
                      </Button>
                    </div>
                  </div>
                </div>
              </Panel>
            ) : null}

            {error ? (
              <div className="flex items-start gap-2 rounded-[8px] border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-100">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            ) : null}

            <Panel title={dataset?.title ?? "Данные"} icon={BarChart3}>
              {loading ? (
                <div className="mb-3 rounded-[6px] border border-zinc-800 bg-black/25 p-3 text-sm text-zinc-400">Загрузка данных...</div>
              ) : null}
              {dataset ? (
                <>
                  <MetricCards payload={dataset.payload} />
                  <MiniChart payload={dataset.payload} rows={rows} />
                  {section === "health" ? <HealthGrid payload={dataset.payload} /> : null}
                  <div className={cx("mt-4", !findMetrics(dataset.payload).length && "mt-0")}>
                    <SmartTable rows={rows} section={section} selected={selectedRow} onSelect={selectRow} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button icon={RefreshCw} variant="ghost" onClick={() => void execute(selectedAction)} disabled={loading}>
                      Обновить
                    </Button>
                    <Button icon={ChevronRight} variant="ghost" onClick={() => void execute(selectedAction, true)} disabled={loading || !nextPage}>
                      Загрузить ещё
                    </Button>
                  </div>
                </>
              ) : (
                <div className="grid gap-3 md:grid-cols-3">
                  {[
                    ["Пользователи", "Ищите людей, открывайте карточки и смотрите историю."],
                    ["Матчи и рейтинг", "Сравнивайте активность, результаты и динамику рейтинга."],
                    ["Сервисы", "Проверяйте состояние backend-сервисов цветными индикаторами."],
                  ].map(([title, text]) => (
                    <div key={title} className="rounded-[6px] border border-zinc-800 bg-black/25 p-4">
                      <div className="text-sm font-semibold text-zinc-100">{title}</div>
                      <div className="mt-2 text-sm leading-5 text-zinc-500">{text}</div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <DetailCard row={selectedRow} dataset={dataset} section={section} />
        </main>
      </div>
    </div>
  );
}
