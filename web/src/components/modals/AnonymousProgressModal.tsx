import { useCallback } from "react";
import { LogIn, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AnonymousProgressModal({
  onLogin,
  onRegister,
  onClose,
}: {
  onLogin: () => void;
  onRegister: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/72 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="anonymous-progress-title"
      onMouseDown={onClose}
    >
      <div
        className="h-screen w-full overflow-y-auto border-x-0 border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)] sm:h-auto sm:max-w-md sm:rounded-none sm:border"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
              Anonymous Session
            </div>
            <h2
              id="anonymous-progress-title"
              className="mt-2 text-lg font-black uppercase tracking-[0.14em] text-zinc-100"
            >
              Progress Won't Save
            </h2>
          </div>
          <button
            className="inline-flex h-10 w-10 items-center justify-center border border-zinc-800 bg-black/80 text-zinc-400 transition-colors hover:border-purple-400 hover:text-white"
            onClick={onClose}
            type="button"
            aria-label="Close anonymous progress prompt"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div className="border border-zinc-800 bg-black/60 px-4 py-3 text-sm leading-6 text-zinc-300">
            You are playing as an anonymous user. Match progress, stats, and rewards will not be
            saved after you leave.
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              size="wireMedium"
              className="h-11"
              onClick={onRegister}
            >
              Register
            </Button>
            <Button
              type="button"
              size="wireMedium"
              variant="outline"
              className="h-11"
              onClick={onLogin}
            >
              Login
            </Button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-full border border-zinc-800 bg-black/70 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-300"
          >
            Continue as Anonymous
          </button>
        </div>
      </div>
    </div>
  );
}

