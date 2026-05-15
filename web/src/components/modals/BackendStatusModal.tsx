import type React from "react";

export function BackendStatusModal({
  message,
}: {
  message: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/82 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="backend-status-title"
    >
      <div className="w-full max-w-xl border border-red-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(239,68,68,0.18)]">
        <div className="border-b border-border px-5 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
            Service Status
          </div>
          <h2
            id="backend-status-title"
            className="mt-2 text-lg font-black uppercase tracking-[0.14em] text-zinc-100"
          >
            Something Broke
          </h2>
        </div>
        <div className="space-y-4 p-5">
          <div className="border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm leading-6 text-zinc-200">
            {message}
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-11 w-full items-center justify-center border border-red-500/45 bg-red-950/35 text-[10px] font-semibold uppercase tracking-[0.14em] text-red-100 transition-colors hover:border-red-300 hover:text-white"
          >
            Reload Page
          </button>
        </div>
      </div>
    </div>
  );
}

