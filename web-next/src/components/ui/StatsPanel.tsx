import { Signal } from "lucide-react";
import { cn } from "@/lib/utils";
import { getRankClass } from "@/lib/utils-app";
import type { StatsSnapshot } from "@/types/app";

export function StatsPanel({
  onOpenDetails,
  stats,
  loading,
}: {
  onOpenDetails: () => void;
  stats: StatsSnapshot | null;
  loading: boolean;
}) {
  const progress = stats ? Math.max(0, Math.min(100, stats.progressPercent)) : 0;
  const remaining = stats ? Math.max(0, stats.nextRankRating - stats.rating) : 0;

  return (
    <div
      className={cn(
        "flex h-full flex-col justify-between border border-border bg-zinc-950/80 p-3 text-left transition-opacity duration-300 sm:p-4",
        loading && "opacity-90",
      )}
    >
      {/* Rank badge — hero element */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Signal className="h-3.5 w-3.5 text-purple-400" aria-hidden="true" />
          <span className="text-[9px] font-black uppercase tracking-[0.16em] text-zinc-500">
            Rating
          </span>
        </div>
        {loading ? (
          <div className="h-6 w-20 animate-pulse bg-zinc-800/80" />
        ) : !stats ? (
          <span className="border border-zinc-800 bg-black/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
            No Data
          </span>
        ) : (
          <span className={cn("border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em]", getRankClass(stats.rank))}>
            {stats.rank}
          </span>
        )}
      </div>

      {/* Rating number */}
      <div>
        {loading ? (
          <div className="h-14 w-36 animate-pulse bg-zinc-800/80" />
        ) : !stats ? (
          <div className="text-4xl font-black tabular-nums text-zinc-700">—</div>
        ) : (
          <div className="text-5xl font-black tabular-nums leading-none text-zinc-100 transition-all duration-300">
            {stats.rating}
          </div>
        )}
        <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
          Current rating
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
            → {stats?.nextRank ?? "Next rank"}
          </span>
          {loading ? (
            <div className="h-3 w-8 animate-pulse bg-zinc-800/80" />
          ) : (
            <span className="text-[10px] font-black tabular-nums text-purple-300 transition-all duration-300">
              {stats ? `${progress}%` : "--"}
            </span>
          )}
        </div>
        <div className="h-3 overflow-hidden bg-zinc-900/80">
          <div
            className={cn(
              "h-full bg-gradient-to-r from-purple-600 to-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.7)] transition-[width] duration-500 ease-out",
              loading && "animate-pulse bg-gradient-to-r from-zinc-700 to-zinc-600 shadow-none",
            )}
            style={{ width: `${loading ? 38 : progress}%` }}
          />
        </div>
        {!loading && stats && (
          <div className="mt-1.5 text-[9px] uppercase tracking-[0.1em] text-zinc-700">
            {remaining} pts to next rank
          </div>
        )}
      </div>

      {/* Wins / Streak / Details */}
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <div className="border border-zinc-900 bg-black/60 p-2.5">
          <div className="text-[9px] uppercase tracking-[0.12em] text-zinc-600">Wins</div>
          {loading ? (
            <div className="mt-1.5 h-6 w-10 animate-pulse bg-zinc-800/80" />
          ) : (
            <div className="mt-1 text-xl font-black tabular-nums text-zinc-100 transition-all duration-300">
              {stats?.wins ?? "--"}
            </div>
          )}
        </div>
        <div className="border border-zinc-900 bg-black/60 p-2.5">
          <div className="text-[9px] uppercase tracking-[0.12em] text-zinc-600">Streak</div>
          {loading ? (
            <div className="mt-1.5 h-6 w-10 animate-pulse bg-zinc-800/80" />
          ) : (
            <div className="mt-1 text-xl font-black tabular-nums text-zinc-100 transition-all duration-300">
              {stats ? `+${stats.streak}` : "--"}
            </div>
          )}
        </div>
        <button
          className="inline-flex h-full min-h-[52px] items-center justify-center border border-purple-500/45 bg-purple-950/35 px-3 text-[10px] font-black uppercase tracking-[0.14em] text-purple-200 transition-colors hover:border-purple-300 hover:bg-purple-900/45 hover:text-white disabled:pointer-events-none disabled:opacity-30"
          onClick={onOpenDetails}
          type="button"
          disabled={!stats && !loading}
        >
          Details
        </button>
      </div>
    </div>
  );
}
