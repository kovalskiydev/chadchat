import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getChatStyleFrameClass,
  getChatStyleTextClass,
  getChatTextClass,
  getInlineColorStyle,
  getNickColorClass,
  getTitleBorderColorClass,
  getTitleBorderShapeClass,
  isAdminRole,
  isAnimatedTitle,
} from "@/lib/utils-app";
import { Avatar } from "@/components/ui/Avatar";
import { AdminBadge } from "@/components/ui/AdminBadge";
import type { ChatCustomization, ChatMessage } from "@/types/app";

export function ChatMessageItem({
  message,
  chatCustomization,
  onOpenProfile,
  canDelete,
  onDelete,
}: {
  message: ChatMessage;
  chatCustomization: ChatCustomization;
  onOpenProfile?: (userID: string) => void;
  canDelete?: boolean;
  onDelete?: (messageID: string | number) => void;
}) {
  const [entered, setEntered] = useState(false);
  const style = message.chatStyle;
  const titleStyle = style?.title;
  const nicknameStyle = style?.nickname;
  const textStyle = style?.text;
  const avatarStyle = style?.avatar;
  const titleLabel = titleStyle?.label ?? (message.mine ? chatCustomization.title : null);
  const titleFrameColor = titleStyle?.frame_color ?? titleStyle?.color;
  const titleInlineStyle = getInlineColorStyle(titleStyle);
  const nicknameInlineStyle = getInlineColorStyle(nicknameStyle);
  const textInlineStyle = textStyle?.color ? { color: textStyle.color } : undefined;
  const avatarUrl = avatarStyle?.url || message.avatarUrl;
  const isAdmin = isAdminRole(message.role);
  const showDelete = Boolean(canDelete && !message.isDeleted && !message.pending);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className={cn(
        "grid grid-cols-[28px_1fr] gap-2 border border-zinc-900 bg-black/72 p-2 text-left transition-all duration-300 ease-out",
        entered ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        message.mine && "border-purple-500/55 bg-purple-950/25",
        message.pending && "animate-pulse border-purple-400/40",
      )}
    >
      <button
        type="button"
        className="h-7 w-7"
        disabled={!message.userId || !onOpenProfile}
        onClick={() => message.userId && onOpenProfile?.(message.userId)}
        aria-label={`Open ${message.user} profile`}
      >
        <Avatar user={message.user} className="h-7 w-7" src={avatarUrl} />
      </button>
      <div className="min-w-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {titleLabel && (
              <span
                className={cn(
                  "shrink-0 bg-purple-950/35 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]",
                  titleFrameColor ? "border" : getTitleBorderColorClass(chatCustomization.titleBorderColor),
                  getChatStyleFrameClass(titleStyle?.shape, titleStyle?.frame),
                  !titleStyle && getTitleBorderShapeClass(chatCustomization.titleBorderShape),
                  (titleStyle?.animated || (!titleStyle && isAnimatedTitle(chatCustomization.title))) &&
                    "animate-pulse",
                )}
                style={{
                  ...titleInlineStyle,
                  ...(titleFrameColor ? { borderColor: titleFrameColor } : {}),
                }}
              >
                {titleLabel}
              </span>
            )}
            {style?.badges?.map((badge) => (
              <span
                className="shrink-0 border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-[8px] font-black uppercase tracking-[0.1em] text-zinc-300"
                key={badge.id ?? badge.label}
                style={badge.color ? { color: badge.color, borderColor: badge.color } : undefined}
              >
                {badge.label ?? badge.id}
              </span>
            ))}
            <span
              className={cn(
                "truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500",
                nicknameStyle && "font-black",
                !nicknameStyle && message.mine && "bg-clip-text font-black text-transparent",
                !nicknameStyle && message.mine && getNickColorClass(chatCustomization.nameColor),
                nicknameStyle?.animated && "animate-pulse",
              )}
              style={nicknameInlineStyle}
              role={message.userId && onOpenProfile ? "button" : undefined}
              tabIndex={message.userId && onOpenProfile ? 0 : undefined}
              onClick={() => message.userId && onOpenProfile?.(message.userId)}
              onKeyDown={(event) => {
                if (!message.userId || !onOpenProfile) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenProfile(message.userId);
                }
              }}
            >
              {message.user}
            </span>
            {isAdmin && <AdminBadge />}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {showDelete && (
              <button
                className="inline-flex h-5 w-5 items-center justify-center border border-red-500/35 bg-red-950/20 text-red-300 transition-colors hover:border-red-400 hover:text-red-100"
                type="button"
                title="Delete message"
                aria-label="Delete message"
                onClick={() => onDelete?.(message.id)}
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full shadow-[0_0_10px_rgba(168,85,247,0.85)]",
                message.pending ? "bg-zinc-300" : "bg-purple-400",
              )}
            />
          </div>
        </div>
        {message.isDeleted ? (
          <p className="text-xs italic leading-5 text-zinc-600">Message deleted by moderator</p>
        ) : (
          <p
            className={cn(
              "break-words text-xs leading-5 transition-opacity duration-200",
              textStyle
                ? getChatStyleTextClass(textStyle.style)
                : message.mine
                  ? getChatTextClass(chatCustomization.textStyle)
                  : "text-zinc-300",
              textStyle?.animated && "animate-pulse",
              message.pending && "opacity-75",
            )}
            style={textInlineStyle}
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
