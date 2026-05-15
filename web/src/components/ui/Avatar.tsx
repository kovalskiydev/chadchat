import { cn } from "@/lib/utils";
import { getAvatarClass, getAvatarInitials, getPositionClass } from "@/lib/utils-app";

export function Avatar({
  user,
  className,
  src,
}: {
  user: string;
  className?: string;
  src?: string | null;
}) {
  if (src) {
    return (
      <img
        alt=""
        className={cn("shrink-0 border border-white/10 object-cover", className)}
        src={src}
      />
    );
  }

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center border border-white/10 bg-gradient-to-br text-[10px] font-black uppercase tracking-[0.08em] text-white shadow-[0_0_16px_rgba(132,0,255,0.18)]",
        getAvatarClass(user),
        className,
      )}
    >
      {getAvatarInitials(user)}
    </div>
  );
}

export function PositionAvatar({
  position,
  user,
  avatarUrl,
  onClick,
}: {
  position: number;
  user: string;
  avatarUrl?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="relative h-9 w-9 shrink-0 disabled:pointer-events-none"
      onClick={onClick}
      disabled={!onClick}
      aria-label={`Open ${user} profile`}
    >
      <Avatar user={user} className="h-9 w-9" src={avatarUrl} />
      <span
        className={cn(
          "absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center border px-1 text-[9px] font-black tabular-nums",
          getPositionClass(position),
        )}
      >
        {String(position).padStart(2, "0")}
      </span>
    </button>
  );
}
