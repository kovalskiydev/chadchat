import { Loader2 } from "lucide-react";

export function VerificationStartingModal({
  status,
}: {
  status: string | null;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/78 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="verification-starting-title"
    >
      <div className="h-screen w-full overflow-y-auto border-x-0 border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)] sm:h-auto sm:max-w-md sm:rounded-none sm:border">
        <div className="border-b border-border px-5 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
            Verification
          </div>
          <h2
            id="verification-starting-title"
            className="mt-2 text-lg font-black uppercase tracking-[0.14em] text-zinc-100"
          >
            Starting Camera Check
          </h2>
        </div>
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-3 border border-zinc-800 bg-black/60 px-4 py-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-purple-300" />
            <div className="text-sm text-zinc-300">
              {status ?? "Contacting verification service..."}
            </div>
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
            Please wait. The webcam step will open automatically.
          </div>
        </div>
      </div>
    </div>
  );
}

