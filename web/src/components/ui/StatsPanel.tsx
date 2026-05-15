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
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Statistics
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Signal className="h-4 w-4 text-purple-300" aria-hidden="true" />
            <span className="text-lg font-black uppercase tracking-[0.14em] text-zinc-100">
              Stats
            </span>
          </div>
        </div>
        {loading ? (
          <span className="h-7 w-20 animate-pulse border border-zinc-800 bg-zinc-900/80" />
        ) : !stats ? (
          <span className="border border-zinc-800 bg-black/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
            No Data
          </span>
        ) : (
          <span
            className={cn(
              "border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]",
              getRankClass(stats.rank),
            )}
          >
            {stats.rank}
          </span>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
            Current Rating
          </div>
          {loading ? (
            <div className="mt-2 h-10 w-28 animate-pulse bg-zinc-900/80" />
          ) : !stats ? (
            <div className="mt-2 text-xl font-black uppercase tracking-[0.12em] text-zinc-600">
              Unavailable
            </div>
          ) : (
            <div className="mt-1 text-3xl font-black tabular-nums text-zinc-100 transition-all duration-300">
              {stats.rating}
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Progress to {stats?.nextRank ?? "Next Rank"}
            </span>
            {loading ? (
              <span className="h-4 w-10 animate-pulse bg-zinc-900/80" />
          ) : !stats ? (
            <span className="text-[10px] font-semibold tabular-nums text-zinc-600">
              --
            </span>
          ) : (
              <span className="text-[10px] font-semibold tabular-nums text-purple-200 transition-all duration-300">
                {progress}%
              </span>
            )}
          </div>
          <div className="h-2 overflow-hidden bg-zinc-900">
            <div
              className={cn(
                "h-full bg-purple-400 shadow-[0_0_14px_rgba(168,85,247,0.9)] transition-[width] duration-500 ease-out",
                loading && "animate-pulse bg-zinc-700 shadow-none",
              )}
              style={{ width: `${loading ? 38 : progress}%` }}
            />
          </div>
          {loading ? (
            <div className="mt-2 h-4 w-24 animate-pulse bg-zinc-900/80" />
          ) : !stats ? (
            <div className="mt-2 text-[10px] uppercase tracking-[0.12em] text-zinc-600">
              Stats did not load
            </div>
          ) : (
            <div className="mt-2 text-[10px] uppercase tracking-[0.12em] text-zinc-600 transition-all duration-300">
              {remaining} rating left
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <div className="border border-zinc-900 bg-black/70 p-2.5">
          <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
            Wins
          </div>
          {loading ? (
            <div className="mt-2 h-5 w-10 animate-pulse bg-zinc-900/80" />
          ) : !stats ? (
            <div className="mt-1 text-base font-black tabular-nums text-zinc-600">
              --
            </div>
          ) : (
            <div className="mt-1 text-base font-black tabular-nums text-zinc-100 transition-all duration-300">
              {stats.wins}
            </div>
          )}
        </div>
        <div className="border border-zinc-900 bg-black/70 p-2.5">
          <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
            Streak
          </div>
          {loading ? (
            <div className="mt-2 h-5 w-10 animate-pulse bg-zinc-900/80" />
          ) : !stats ? (
            <div className="mt-1 text-base font-black tabular-nums text-zinc-600">
              --
            </div>
          ) : (
            <div className="mt-1 text-base font-black tabular-nums text-zinc-100 transition-all duration-300">
              +{stats.streak}
            </div>
          )}
        </div>
        <button
          className="inline-flex h-full min-h-[50px] items-center justify-center border border-purple-500/45 bg-purple-950/35 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-purple-200 transition-colors hover:border-purple-300 hover:bg-purple-900/45 hover:text-white"
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
