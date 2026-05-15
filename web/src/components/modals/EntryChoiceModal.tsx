import { useCallback, useEffect, useState } from "react";
import { LogIn, UserPlus, X } from "lucide-react";

export function EntryChoiceModal({
  onAnonymous,
  onLogin,
  onRegister,
  isStartingVerification,
  verificationStartStatus,
  consentAccepted,
  onConsentChange,
  onOpenRules,
  onOpenPrivacy,
}: {
  onAnonymous: () => void;
  onLogin: () => void;
  onRegister: () => void;
  isStartingVerification: boolean;
  verificationStartStatus: string | null;
  consentAccepted: boolean;
  onConsentChange: (checked: boolean) => void;
  onOpenRules: () => void;
  onOpenPrivacy: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/78 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="entry-choice-title"
    >
      <div className="h-screen w-full overflow-y-auto border-x-0 border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)] sm:h-auto sm:max-w-xl sm:rounded-none sm:border">
        <div className="border-b border-border px-5 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
            Welcome
          </div>
          <h2
            id="entry-choice-title"
            className="mt-2 text-lg font-black uppercase tracking-[0.14em] text-zinc-100"
          >
            Choose Entry
          </h2>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-3">
          <button
            type="button"
            onClick={onAnonymous}
            disabled={isStartingVerification || !consentAccepted}
            className="min-h-40 border border-zinc-900 bg-black/60 p-4 text-left transition-colors hover:border-purple-400 hover:bg-purple-950/24 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="text-sm font-black uppercase tracking-[0.14em] text-zinc-100">
              {isStartingVerification ? "Starting..." : "Anonymous"}
            </div>
            <p className="mt-3 text-xs leading-5 text-zinc-500">
              Continue without registration. Progress will not be saved.
            </p>
          </button>
          <button
            type="button"
            onClick={onLogin}
            className="min-h-40 border border-zinc-900 bg-black/60 p-4 text-left transition-colors hover:border-purple-400 hover:bg-purple-950/24"
          >
            <div className="text-sm font-black uppercase tracking-[0.14em] text-zinc-100">
              Login
            </div>
            <p className="mt-3 text-xs leading-5 text-zinc-500">
              Enter existing account and continue with saved profile.
            </p>
          </button>
          <button
            type="button"
            onClick={onRegister}
            className="min-h-40 border border-zinc-900 bg-black/60 p-4 text-left transition-colors hover:border-purple-400 hover:bg-purple-950/24"
          >
            <div className="text-sm font-black uppercase tracking-[0.14em] text-zinc-100">
              Register
            </div>
            <p className="mt-3 text-xs leading-5 text-zinc-500">
              Create account to keep rating, settings, and progression.
            </p>
          </button>
        </div>
        <div className="px-5 pb-5">
          <label className="grid cursor-pointer grid-cols-[16px_1fr] items-start gap-3 border border-zinc-800 bg-black/60 px-3 py-3">
            <input
              type="checkbox"
              checked={consentAccepted}
              onChange={(event) => onConsentChange(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded-none border border-zinc-600 bg-black accent-purple-400"
            />
            <span className="text-[10px] leading-5 text-zinc-400">
              I agree to the{" "}
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenRules();
                }}
                className="text-zinc-200 underline underline-offset-2 hover:text-white"
              >
                rules
              </button>
              {" "}and{" "}
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenPrivacy();
                }}
                className="text-zinc-200 underline underline-offset-2 hover:text-white"
              >
                privacy policy
              </button>
              , confirm that I am 18+, and consent to the processing of my personal data.
            </span>
          </label>
        </div>
        {verificationStartStatus && (
          <div className="px-5 pb-5">
            <div className="border border-zinc-800 bg-black/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              {verificationStartStatus}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

