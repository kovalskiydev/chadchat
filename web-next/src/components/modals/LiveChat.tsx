import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import {
  ChevronLeft,
  ChevronRight,
  X,
  MessageSquare,
  Send,
  ShoppingBag,
  Signal,
  Trophy,
  UserRoundCog,
  CircleHelp,
  LogOut,
  User,
  Camera,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";

import Crosshair from "@/components/Crosshair";
import GradientText from "@/components/GradientText";
import { GlobalSpotlight, ParticleCard } from "@/components/MagicBento";
import PixelBlast from "@/components/PixelBlast";
import Shuffle from "@/components/Shuffle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AUTH_TOKENS_CHANGED_EVENT,
  authAnonymous,
  authLogin,
  authLogout,
  authRefresh,
  authRegister,
  authUpgrade,
  getMe,
  loadTokens,
  saveTokens,
  type AuthTokens,
  type AuthUser,
  type VerificationStartResponse,
  verificationStart,
  verificationSubmit,
} from "@/lib/auth";
import {
  createTestLabRoom,
  getTestLabSession,
  getTestLabRoom,
  scanTestLabSession,
  startTestLabSession,
  type TestLabRoom,
} from "@/lib/testLab";
import {
  deleteLiveChatMessage,
  getLiveChatHistory,
  sendLiveChatMessage,
  streamLiveChat,
  type ChatStyleSnapshot,
  type LiveChatMessage,
} from "@/lib/liveChat";
import {
  clearChatCustomizationSlot,
  getChatCustomizationCatalog,
  getMyChatCustomization,
  selectChatCustomizationItem,
  type ChatCustomizationCatalog,
  type ChatCustomizationItem,
  type ChatCustomizationSelection,
  type ChatCustomizationSlot,
} from "@/lib/chatCustomization";
import {
  duelCurrentMatch,
  duelGetMatch,
  duelMediaReady,
  duelQueueJoin,
  duelQueueLeave,
  duelRtcConfig,
  duelScoreFrame,
  duelSignal,
  duelStream,
} from "@/lib/duel";
import { getApiHealth } from "@/lib/health";
import {
  getFaceLandmarker,
  preloadFaceLandmarker,
  retryFaceLandmarker,
  type ChadFaceLandmarker,
} from "@/lib/faceLandmarker";
import {
  getLeaderboard,
  getMyMatches,
  getQueueInfo,
  getRecentForm,
  getMyRating,
  getStatsPeriod,
  getStatsSummary,
  type LeaderboardEntry,
  type MatchHistoryEntry,
  type RatingProfile,
  type QueueInfo,
  type StatsPeriod,
  type StatsSummary,
} from "@/lib/rating";
import {
  createAvatarUpload,
  deleteProfileComment,
  getMyProfile,
  getProfileComments,
  getPublicProfile,
  postProfileComment,
  updateMyProfile,
  voteProfileComment,
  type Profile,
  type ProfileComment,
} from "@/lib/profile";
import {
  getResultSounds,
  selectResultSound,
  type ResultSoundOption,
} from "@/lib/resultSounds";
import { Avatar, PositionAvatar } from "@/components/ui/Avatar";
import { AdminBadge } from "@/components/ui/AdminBadge";
import { Panel } from "@/components/ui/Panel";
import { MagicButton } from "@/components/ui/MagicButton";
import { StatsPanel } from "@/components/ui/StatsPanel";
import { ChatMessageItem } from "@/components/ui/ChatMessageItem";
import {
  formatDateShort,
  formatRankLabel,
  buildStatsSnapshot,
  buildPeriodStats,
  mapPeriodStats,
  getAvatarClass,
  getAvatarInitials,
  isAdminRole,
  getNickColorClass,
  getChatTextClass,
  getInlineColorStyle,
  getChatStyleTextClass,
  getChatStyleFrameClass,
  getSelectedChatStyle,
  isAnimatedTitle,
  getTitleBorderColorClass,
  getTitleBorderShapeClass,
  getGameFrameClass,
  normalizeDuelResultSound,
  getRankClass,
  getTopClass,
  getTopAccentClass,
  getPositionClass,
  getTopGradientColors,
  getRoomID,
  formatScoreOutOfTen,
  formatProfileScore,
  profileTitleStyle,
} from "@/lib/utils-app";
import {
  statsByPeriod,
  type StatsPeriodKey,
  type StatsSnapshot,
  type UiPeriodStats,
  type ChatMessage,
  type ChatCustomization,
  type GameCustomization,
  type DuelResultSound,
  defaultChatCustomization,
  defaultGameCustomization,
  initialChatMessages,
  leaderboardPageSize,
} from "@/types/app";
import { magicBlockClass, magicGlow, duelQueueTracks } from "@/lib/constants";

export function LiveChat({
  chatCustomization,
  currentChatStyle,
  currentUserName,
  currentUserRole,
  accessToken,
  chatBlurred,
  onOpenProfile,
}: {
  chatCustomization: ChatCustomization;
  currentChatStyle: ChatStyleSnapshot | null;
  currentUserName: string;
  currentUserRole?: string;
  accessToken: string | null;
  chatBlurred: boolean;
  onOpenProfile: (userID: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialChatMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [avatarByUserId, setAvatarByUserId] = useState<Record<string, string | null>>({});
  const requestedAvatarUserIdsRef = useRef<Set<string>>(new Set());
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const nextIdRef = useRef(initialChatMessages.length + 1);
  const isChatAdmin = isAdminRole(currentUserRole);

  useEffect(() => {
    if (!accessToken) return;
    let mounted = true;
    const controller = new AbortController();

    const messageKey = (msg: ChatMessage) =>
      String(msg.id ?? `${msg.user}|${msg.text}|${msg.createdAt ?? ""}`);

    const messageSignature = (user: string, text: string) =>
      `${user.trim().toLowerCase()}|${text.trim().toLowerCase()}`;

    const dedupeMessages = (list: ChatMessage[]) => {
      const seen = new Set<string>();
      const out: ChatMessage[] = [];
      for (const item of list) {
        const key = messageKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
      }
      return out;
    };

    const mapIncoming = (msg: LiveChatMessage): ChatMessage => {
      const user = (msg.sender_nickname ?? msg.nickname ?? msg.user ?? "USER").toString();
      const userId = msg.sender_id !== undefined ? String(msg.sender_id) : undefined;
      const mine = user.toLowerCase() === currentUserName.toLowerCase();
      return {
        id:
          msg.id ??
          msg.sender_id ??
          `${user}|${msg.text ?? ""}|${msg.created_at ?? ""}`,
        userId,
        role: msg.sender_role,
        avatarUrl:
          msg.sender_avatar_url ||
          msg.avatar_url ||
          msg.chat_style?.avatar?.url,
        createdAt: msg.created_at,
        user,
        text: msg.text ?? "",
        isDeleted: msg.is_deleted,
        chatStyle: msg.chat_style ?? null,
        mine,
      };
    };

    const run = async () => {
      try {
        const history = await getLiveChatHistory(accessToken);
        if (!mounted) return;
        setMessages(dedupeMessages(history.map(mapIncoming)).slice(-40));
      } catch {
        // keep UI usable even if history fails
      }

      try {
        await streamLiveChat(
          accessToken,
          (event, data) => {
            if (!mounted) return;
            const payload = data as Record<string, unknown>;
            if (event === "history") {
              const history =
                (payload.history as LiveChatMessage[] | undefined) ??
                (payload.messages as LiveChatMessage[] | undefined) ??
                [];
              setMessages(dedupeMessages(history.map(mapIncoming)).slice(-40));
              return;
            }
            if (event === "message_deleted" || payload.type === "message_deleted") {
              const messageID =
                payload.message_id ??
                payload.id ??
                (payload.message as { id?: string | number } | undefined)?.id;
              if (messageID === undefined || messageID === null) return;
              setMessages((current) =>
                current.map((message) =>
                  String(message.id) === String(messageID)
                    ? { ...message, text: "", isDeleted: true, pending: false }
                    : message,
                ),
              );
              return;
            }
            if (event === "message") {
              const msg = (payload.message as LiveChatMessage | undefined) ??
                (payload as unknown as LiveChatMessage);
              if (!msg?.text && !msg?.is_deleted) return;
              const incoming = mapIncoming(msg);
              const incomingSignature = messageSignature(incoming.user, incoming.text);
              setMessages((current) =>
                dedupeMessages([
                  ...current
                    .filter(
                      (item) =>
                        !(
                          item.pending &&
                          messageSignature(item.user, item.text) === incomingSignature
                        ),
                    )
                    .slice(-39),
                  incoming,
                ]).slice(-40),
              );
            }
          },
          controller.signal,
        );
      } catch {
        // stream reconnect strategy can be added later
      }
    };

    void run();
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [accessToken, currentUserName]);

  useEffect(() => {
    if (!accessToken) return;
    const missingIds = Array.from(
      new Set(
        messages
          .map((message) => message.userId)
          .filter(
            (id): id is string =>
              Boolean(
                id &&
                  !(id in avatarByUserId) &&
                  !requestedAvatarUserIdsRef.current.has(id),
              ),
          ),
      ),
    );
    if (!missingIds.length) return;
    missingIds.forEach((id) => requestedAvatarUserIdsRef.current.add(id));

    let cancelled = false;
    void Promise.all(
      missingIds.map(async (id) => {
        const profile = await getPublicProfile(accessToken, id).catch(() => null);
        return [id, profile?.avatar_url ?? ""] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setAvatarByUserId((current) => ({
        ...current,
        ...Object.fromEntries(entries.map(([id, avatarUrl]) => [id, avatarUrl || null])),
      }));
      setMessages((current) =>
        current.map((message) => {
          if (message.avatarUrl || !message.userId) return message;
          const avatarUrl = entries.find(([id]) => id === message.userId)?.[1];
          return avatarUrl ? { ...message, avatarUrl } : message;
        }),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [accessToken, avatarByUserId, messages]);

  useEffect(() => {
    if (chatContainerRef.current && chatEndRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !accessToken || sending) return;

    const optimisticId = `pending-${nextIdRef.current++}`;
    setMessages((current) => [
      ...current.slice(-39),
      {
        id: optimisticId,
        user: currentUserName,
        role: currentUserRole,
        text,
        chatStyle: currentChatStyle,
        mine: true,
        pending: true,
      },
    ]);
    setDraft("");
    setSending(true);
    try {
      await sendLiveChatMessage(accessToken, text);
    } catch {
      setMessages((current) =>
        current.map((item) =>
          item.id === optimisticId ? { ...item, pending: false } : item,
        ),
      );
    } finally {
      setSending(false);
    }
  };

  const handleDeleteMessage = async (messageID: string | number) => {
    if (!accessToken || !isChatAdmin) return;
    setMessages((current) =>
      current.map((message) =>
        String(message.id) === String(messageID)
          ? { ...message, text: "", isDeleted: true, pending: false }
          : message,
      ),
    );
    try {
      await deleteLiveChatMessage(accessToken, messageID);
    } catch {
      // The next history/stream update will restore the canonical state if delete failed.
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div
          ref={chatContainerRef}
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3 transition-[filter,opacity] duration-200",
            chatBlurred && "pointer-events-none select-none blur-sm opacity-85",
          )}
        >
          {messages.map((message) => (
            <ChatMessageItem
              chatCustomization={chatCustomization}
              key={message.id}
              message={message}
              onOpenProfile={onOpenProfile}
              canDelete={isChatAdmin}
              onDelete={handleDeleteMessage}
            />
          ))}
          <div ref={chatEndRef} />
        </div>
        {chatBlurred && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="border border-zinc-800 bg-black/75 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-300">
              Chat Blurred
            </div>
          </div>
        )}
      </div>

      <form
        className="grid grid-cols-[1fr_40px] gap-2 border-t border-border p-3"
        onSubmit={handleSubmit}
      >
        <input
          className="h-10 min-w-0 border border-zinc-800 bg-black/80 px-3 text-xs tracking-[0.08em] text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-purple-400"
          onChange={(event) => setDraft(event.target.value)}
          placeholder="TYPE MESSAGE"
          value={draft}
        />
        <button
          className="inline-flex h-10 w-10 items-center justify-center border border-purple-500/50 bg-purple-950/45 text-purple-200 shadow-[0_0_16px_rgba(132,0,255,0.18)] transition-colors hover:border-purple-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          type="submit"
          aria-label="Send message"
          disabled={!accessToken || sending}
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}

