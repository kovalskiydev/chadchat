import { cn } from "@/lib/utils";

export function AdminBadge({ className, onClick }: { className?: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Administrator"
      className={cn(
        "inline-flex shrink-0 items-center border border-red-400/70 bg-red-950/55 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] text-red-100 shadow-[0_0_14px_rgba(248,113,113,0.25)] transition-colors hover:border-red-300 hover:bg-red-900/60 hover:text-white",
        onClick && "cursor-pointer",
        className,
      )}
    >
      ADMIN
    </button>
  );
}
