import type React from "react";

export function VerificationSuccessModal({ onContinue }: { onContinue: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/78 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="verification-success-title"
    >
      <div className="h-screen w-full overflow-y-auto border-x-0 border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)] sm:h-auto sm:max-w-md sm:rounded-none sm:border">
        <div className="border-b border-border px-5 py-4">
          <h2
            id="verification-success-title"
            className="text-base font-black uppercase tracking-[0.14em] text-zinc-100"
          >
            Congratulations
          </h2>
        </div>
        <div className="space-y-4 p-5">
          <p className="text-sm text-zinc-300">
            You passed verification successfully.
          </p>
          <button
            type="button"
            onClick={onContinue}
            className="inline-flex h-10 w-full items-center justify-center border border-purple-500/50 bg-purple-950/35 text-[10px] font-semibold uppercase tracking-[0.14em] text-purple-100 transition-colors hover:border-purple-300 hover:text-white"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

