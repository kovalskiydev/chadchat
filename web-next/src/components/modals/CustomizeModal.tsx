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

export function CustomizeModal({
  chatCustomization,
  chatCatalog,
  chatSelection,
  chatCustomizationLoading,
  chatCustomizationSaving,
  chatCustomizationError,
  resultSoundOptions,
  resultSoundLoading,
  resultSoundVolume,
  onSelectChatCustomization,
  onClearChatCustomization,
  onChangeResultSoundVolume,
  onSelectResultSound,
  onClose,
}: {
  chatCustomization: ChatCustomization;
  chatCatalog: ChatCustomizationCatalog | null;
  chatSelection: ChatCustomizationSelection | null;
  chatCustomizationLoading: boolean;
  chatCustomizationSaving: boolean;
  chatCustomizationError: string | null;
  resultSoundOptions: ResultSoundOption[];
  resultSoundLoading: boolean;
  resultSoundVolume: number;
  onSelectChatCustomization: (
    slot: ChatCustomizationSlot,
    item: ChatCustomizationItem,
  ) => void;
  onClearChatCustomization: (slot: ChatCustomizationSlot) => void;
  onChangeResultSoundVolume: (value: number) => void;
  onSelectResultSound: (sound: ResultSoundOption) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<"menu" | "chat" | "game">("menu");
  const [category, setCategory] = useState<
    "titles" | "colors" | "text" | "frames" | "avatars" | "badges"
  >("titles");
  const [previewSoundId, setPreviewSoundId] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const options = [
    {
      id: "chat" as const,
      title: "Chat",
      description: "Messages, avatar style, badges, and chat effects.",
      icon: MessageSquare,
    },
    {
      id: "game" as const,
      title: "Game",
      description: "Rank visuals, match HUD, queue theme, and effects.",
      icon: Trophy,
    },
  ];
  const isChatView = view === "chat";
  const selectedChatStyle = getSelectedChatStyle(chatCatalog, chatSelection);
  const previewColor = selectedChatStyle?.nickname
    ? ""
    : getNickColorClass(chatCustomization.nameColor);
  const categoryItems = [
    { id: "titles" as const, label: "Title" },
    { id: "colors" as const, label: "Nick" },
    { id: "text" as const, label: "Text" },
    { id: "frames" as const, label: "Frame" },
    { id: "avatars" as const, label: "Avatar" },
    { id: "badges" as const, label: "Badge" },
  ];
  const isGameView = view === "game";

  const stopPreview = useCallback(() => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
      previewAudioRef.current = null;
    }
    setPreviewSoundId(null);
  }, []);

  const handlePreviewSound = useCallback(
    (sound: ResultSoundOption) => {
      if (previewSoundId === sound.id) {
        stopPreview();
        return;
      }
      stopPreview();
      if (!sound.audio_url) return;
      const audio = new Audio(sound.audio_url);
      audio.volume = Math.max(0, Math.min(1, resultSoundVolume));
      audio.onended = () => {
        if (previewAudioRef.current === audio) {
          previewAudioRef.current = null;
          setPreviewSoundId(null);
        }
      };
      audio.onpause = () => {
        if (previewAudioRef.current === audio) {
          previewAudioRef.current = null;
          setPreviewSoundId(null);
        }
      };
      audio.onerror = () => {
        if (previewAudioRef.current === audio) {
          previewAudioRef.current = null;
          setPreviewSoundId(null);
        }
      };
      previewAudioRef.current = audio;
      setPreviewSoundId(sound.id);
      void audio.play().catch(() => {
        if (previewAudioRef.current === audio) {
          previewAudioRef.current = null;
          setPreviewSoundId(null);
        }
      });
    },
    [previewSoundId, resultSoundVolume, stopPreview],
  );

  useEffect(() => {
    if (previewAudioRef.current) {
      previewAudioRef.current.volume = Math.max(0, Math.min(1, resultSoundVolume));
    }
  }, [resultSoundVolume]);

  useEffect(() => {
    return () => {
      stopPreview();
    };
  }, [stopPreview]);

  const selectedIdsByCategory = {
    titles: chatSelection?.title_id,
    colors: chatSelection?.nickname_color_id,
    text: chatSelection?.text_style_id,
    frames: chatSelection?.title_frame_id,
    avatars: chatSelection?.avatar_id,
    badges: undefined,
  };
  const slotByCategory: Record<typeof category, ChatCustomizationSlot> = {
    titles: "title",
    colors: "nickname_color",
    text: "text_style",
    frames: "title_frame",
    avatars: "avatar",
    badges: "badge",
  };
  const catalogItemsByCategory = {
    titles: chatCatalog?.titles ?? [],
    colors: chatCatalog?.nickname_colors ?? [],
    text: chatCatalog?.text_styles ?? [],
    frames: chatCatalog?.title_frames ?? [],
    avatars: chatCatalog?.avatars ?? [],
    badges: chatCatalog?.badges ?? [],
  };
  const activeCatalogItems = catalogItemsByCategory[category];

  const renderCatalogItem = (item: ChatCustomizationItem) => {
    const slot = slotByCategory[category];
    const isBadgeSelected = chatSelection?.badge_ids?.includes(item.id) ?? false;
    const selected =
      category === "badges"
        ? isBadgeSelected
        : selectedIdsByCategory[category] === item.id;
    const locked = !item.owned;
    const previewColors = item.preview?.gradient ?? item.preview?.colors;
    const swatchStyle =
      Array.isArray(previewColors) && previewColors.length > 1
        ? { backgroundImage: `linear-gradient(90deg, ${previewColors.join(", ")})` }
        : item.preview?.color
          ? { backgroundColor: item.preview.color }
          : undefined;

    return (
      <button
        className={cn(
          "min-h-24 border bg-black/60 p-3 text-left transition-colors",
          locked && "cursor-not-allowed border-zinc-900 bg-black/50 opacity-45",
          !locked &&
            (selected
              ? "border-purple-400 bg-purple-950/35 text-purple-100"
              : "border-zinc-700 bg-zinc-900/55 text-zinc-200 hover:border-purple-500/60"),
        )}
        disabled={locked || chatCustomizationSaving}
        key={item.id}
        onClick={() => onSelectChatCustomization(slot, item)}
        type="button"
      >
        <div className="mb-5 flex items-center justify-between gap-2">
          <span
            className={cn(
              "h-4 w-4 border border-zinc-700 bg-purple-400",
              category === "avatars" && "h-6 w-6",
            )}
            style={swatchStyle}
          />
          <span className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
            {locked
              ? item.locked_reason ?? "Locked"
              : selected
                ? "Selected"
                : item.preview?.animated
                  ? "Animated"
                  : item.rarity ?? "Owned"}
          </span>
        </div>
        <div
          className={cn(
            "text-xs font-black uppercase tracking-[0.12em]",
            item.preview?.animated && "animate-pulse text-purple-200",
          )}
        >
          {item.preview?.label ?? item.title}
        </div>
        {item.description && (
          <p className="mt-2 text-[10px] leading-4 text-zinc-500">
            {item.description}
          </p>
        )}
      </button>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/72 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customize-modal-title"
      onMouseDown={onClose}
    >
      <div
        className="h-screen w-full overflow-y-auto border-x-0 border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)] sm:h-auto sm:max-w-xl sm:rounded-none sm:border"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
              Customize
            </div>
            <h2
              className="mt-2 text-lg font-black uppercase tracking-[0.14em] text-zinc-100"
              id="customize-modal-title"
            >
              {isChatView
                ? "Chat Settings"
                : isGameView
                  ? "Game Settings"
                  : "Choose Area"}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {view !== "menu" && (
              <button
                className="inline-flex h-10 items-center justify-center border border-zinc-800 bg-black/80 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 transition-colors hover:border-purple-400 hover:text-white"
                onClick={() => setView("menu")}
                type="button"
              >
                Back
              </button>
            )}
            <button
              className="inline-flex h-10 w-10 items-center justify-center border border-zinc-800 bg-black/80 text-zinc-400 transition-colors hover:border-purple-400 hover:text-white"
              onClick={onClose}
              type="button"
              aria-label="Close customization"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {isChatView ? (
          <div className="space-y-5 p-5">
            <div className="grid grid-cols-3 border border-zinc-900 bg-black/60 p-1 sm:grid-cols-6">
              {categoryItems.map((item) => (
                <button
                  className={cn(
                    "h-9 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 transition-colors hover:text-zinc-100",
                    category === item.id && "bg-purple-950/55 text-purple-100",
                  )}
                  key={item.id}
                  onClick={() => setCategory(item.id)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="max-h-[320px] overflow-y-auto pr-1">
              {chatCustomizationLoading ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div
                      className="h-24 animate-pulse border border-zinc-900 bg-black/60"
                      key={index}
                    />
                  ))}
                </div>
              ) : chatCustomizationError ? (
                <div className="border border-red-500/45 bg-red-950/35 px-3 py-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-200">
                  {chatCustomizationError}
                </div>
              ) : activeCatalogItems.length ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {activeCatalogItems.map(renderCatalogItem)}
                </div>
              ) : (
                <div className="border border-zinc-900 bg-black/60 px-3 py-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  No items in this slot
                </div>
              )}
            </div>

            <div className="border border-zinc-900 bg-black/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                  Preview
                </div>
                {category !== "badges" && (
                  <button
                    className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 transition-colors hover:text-zinc-200"
                    disabled={chatCustomizationSaving}
                    onClick={() => onClearChatCustomization(slotByCategory[category])}
                    type="button"
                  >
                    Clear slot
                  </button>
                )}
              </div>
              <div className="mt-3 flex items-center gap-2">
                {selectedChatStyle?.avatar?.url && (
                  <img
                    alt=""
                    className="h-7 w-7 border border-zinc-800 object-cover"
                    src={selectedChatStyle.avatar.url}
                  />
                )}
                {selectedChatStyle?.title?.label && (
                  <span
                    className={cn(
                      "border bg-purple-950/35 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]",
                      getChatStyleFrameClass(
                        selectedChatStyle.title.shape,
                        selectedChatStyle.title.frame,
                      ),
                      selectedChatStyle.title.animated && "animate-pulse",
                    )}
                    style={{
                      ...getInlineColorStyle(selectedChatStyle.title),
                      ...(selectedChatStyle.title.frame_color
                        ? { borderColor: selectedChatStyle.title.frame_color }
                        : {}),
                    }}
                  >
                    {selectedChatStyle.title.label}
                  </span>
                )}
                <span
                  className={cn(
                    "text-sm font-black uppercase tracking-[0.12em]",
                    !selectedChatStyle?.nickname &&
                      "bg-clip-text text-transparent",
                    previewColor,
                    selectedChatStyle?.nickname?.animated && "animate-pulse",
                  )}
                  style={getInlineColorStyle(selectedChatStyle?.nickname)}
                >
                  volatileMS
                </span>
                {selectedChatStyle?.badges?.map((badge) => (
                  <span
                    className="border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-[8px] font-black uppercase tracking-[0.1em] text-zinc-300"
                    key={badge.id ?? badge.label}
                    style={
                      badge.color
                        ? { color: badge.color, borderColor: badge.color }
                        : undefined
                    }
                  >
                    {badge.label ?? badge.id}
                  </span>
                ))}
                <span
                  className={cn(
                    "text-xs",
                    selectedChatStyle?.text
                      ? getChatStyleTextClass(selectedChatStyle.text.style)
                      : getChatTextClass(chatCustomization.textStyle),
                    selectedChatStyle?.text?.animated && "animate-pulse",
                  )}
                  style={
                    selectedChatStyle?.text?.color
                      ? { color: selectedChatStyle.text.color }
                      : undefined
                  }
                >
                  Message style
                </span>
              </div>
            </div>
          </div>
        ) : isGameView ? (
          <div className="space-y-5 p-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
                  Result Sound
                </div>
                {resultSoundLoading && (
                  <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                    Loading...
                  </div>
                )}
              </div>
              <div className="border border-zinc-900 bg-black/50 p-3">
                <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                  <span>Volume</span>
                  <span className="text-zinc-300">{Math.round(resultSoundVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={resultSoundVolume}
                  onChange={(event) =>
                    onChangeResultSoundVolume(Number(event.target.value))
                  }
                  className="w-full accent-purple-400"
                />
              </div>
              <div className="max-h-[264px] space-y-2 overflow-y-auto pr-1">
                {resultSoundOptions.map((sound) => {
                  const locked = !sound.owned;
                  return (
                    <div className="grid grid-cols-[1fr_auto] gap-2" key={sound.id}>
                      <button
                        className={cn(
                          "border px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors",
                          locked && "cursor-not-allowed border-zinc-900 bg-black/60 text-zinc-700",
                          !locked &&
                            (sound.selected
                              ? "border-purple-400 bg-purple-950/35 text-purple-100"
                              : "border-zinc-700 bg-zinc-900/55 text-zinc-200 hover:border-purple-500/60"),
                        )}
                        disabled={locked}
                        onClick={() => onSelectResultSound(sound)}
                        type="button"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span>{sound.title}</span>
                          <span className="text-[9px] uppercase tracking-[0.12em] text-zinc-500">
                            {locked ? "Locked" : sound.selected ? "Selected" : sound.is_default ? "Default" : "Owned"}
                          </span>
                        </div>
                      </button>
                      <button
                        className={cn(
                          "border px-3 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors",
                          !sound.audio_url
                            ? "cursor-not-allowed border-zinc-900 bg-black/60 text-zinc-700"
                            : "border-zinc-700 bg-zinc-900/55 text-zinc-200 hover:border-purple-500/60",
                        )}
                        disabled={!sound.audio_url}
                        onClick={() => handlePreviewSound(sound)}
                        type="button"
                      >
                        {previewSoundId === sound.id ? "Stop" : "Start"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            {options.map((option) => {
              const Icon = option.icon;

              return (
                <button
                  className={cn(
                    "min-h-44 border bg-black/60 p-4 text-left transition-colors",
                    "border-zinc-900 hover:border-purple-400 hover:bg-purple-950/24 hover:shadow-[0_0_22px_rgba(132,0,255,0.18)]",
                  )}
                  key={option.id}
                  onClick={() => {
                    if (option.id === "chat") setView("chat");
                    else setView("game");
                  }}
                  type="button"
                >
                  <div className="mb-8 flex items-center justify-between">
                    <Icon
                      className="h-5 w-5 text-zinc-500 transition-colors"
                      aria-hidden="true"
                    />
                    <span className="h-2 w-2 bg-zinc-800" />
                  </div>
                  <div className="text-base font-black uppercase tracking-[0.14em] text-zinc-100">
                    {option.title}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-zinc-500">
                    {option.description}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

