import type React from "react";
import { X } from "lucide-react";

export function LegalModal({
  kind,
  onClose,
}: {
  kind: "rules" | "privacy";
  onClose: () => void;
}) {
  const isRules = kind === "rules";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/78 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-modal-title"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-2xl border border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
              Legal
            </div>
            <h2
              id="legal-modal-title"
              className="mt-2 text-lg font-black uppercase tracking-[0.14em] text-zinc-100"
            >
              {isRules ? "Rules" : "Privacy Policy"}
            </h2>
          </div>
          <button
            className="inline-flex h-10 w-10 items-center justify-center border border-zinc-800 bg-black/80 text-zinc-400 transition-colors hover:border-purple-400 hover:text-white"
            onClick={onClose}
            type="button"
            aria-label="Close legal modal"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5 text-sm leading-6 text-zinc-300">
          {isRules ? (
            <>
              <div className="border border-zinc-800 bg-black/60 px-4 py-3">
                Use the service lawfully, do not harass other users, and do not upload illegal,
                exploitative, or non-consensual content.
              </div>
              <div className="border border-zinc-800 bg-black/60 px-4 py-3">
                You must be at least 18 years old to use camera-based features, matchmaking, and
                chat.
              </div>
              <div className="border border-zinc-800 bg-black/60 px-4 py-3">
                Do not impersonate other people, attempt to bypass moderation, attack the service,
                or interfere with other matches.
              </div>
              <div className="border border-zinc-800 bg-black/60 px-4 py-3">
                Accounts, ratings, and access may be limited or removed for abuse, fraud, or
                repeated policy violations.
              </div>
            </>
          ) : (
            <>
              <div className="border border-zinc-800 bg-black/60 px-4 py-3">
                The service may process your account data, nickname, authentication data, chat
                messages, camera frames used for verification or scoring, and technical logs needed
                for security and operation.
              </div>
              <div className="border border-zinc-800 bg-black/60 px-4 py-3">
                Camera and audio access are used only for features you explicitly start, such as
                verification, Test Lab, and live matches.
              </div>
              <div className="border border-zinc-800 bg-black/60 px-4 py-3">
                Anonymous sessions may be temporary, while registered accounts may retain profile
                and progression data needed to provide the service.
              </div>
              <div className="border border-zinc-800 bg-black/60 px-4 py-3">
                By continuing with consent, you allow the service to process personal data required
                to authenticate you, operate core features, prevent abuse, and improve reliability.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

