"use client";

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
import { Button } from "@/components/ui/button";

import Crosshair from "@/components/Crosshair";
import GradientText from "@/components/GradientText";
import { GlobalSpotlight, ParticleCard } from "@/components/MagicBento";
import PixelBlast from "@/components/PixelBlast";
import Shuffle from "@/components/Shuffle";
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
import { StatsModal } from "@/components/modals/StatsModal";
import { CustomizeModal } from "@/components/modals/CustomizeModal";
import { LiveChat } from "@/components/modals/LiveChat";
import { AuthModal } from "@/components/modals/AuthModal";
import { VerificationModal } from "@/components/modals/VerificationModal";
import { TopsLeaderboard } from "@/components/modals/TopsLeaderboard";
import { StartModesModal } from "@/components/modals/StartModesModal";
import { DuelModal } from "@/components/modals/DuelModal";
import { ProfileModal } from "@/components/modals/ProfileModal";
import { TestLabModal } from "@/components/modals/TestLabModal";
import { AnonymousProgressModal } from "@/components/modals/AnonymousProgressModal";
import { VerificationStartingModal } from "@/components/modals/VerificationStartingModal";
import { BackendStatusModal } from "@/components/modals/BackendStatusModal";
import { LegalModal } from "@/components/modals/LegalModal";
import { EntryChoiceModal } from "@/components/modals/EntryChoiceModal";
import { VerificationSuccessModal } from "@/components/modals/VerificationSuccessModal";
import AdminModal from "@/components/modals/AdminModal";


export default function HomePage() {
  const ENTRY_SEEN_KEY = "chadchat_entry_seen_v1";
  const CONSENT_ACCEPTED_KEY = "chadchat_consent_accepted_v1";
  const RESULT_SOUND_ENABLED_KEY = "chadchat_result_sound_enabled_v1";
  const RESULT_SOUND_VOLUME_KEY = "chadchat_result_sound_volume_v1";
  const CHAT_BLUR_KEY = "chadchat_chat_blur_enabled_v1";
  const startButtonRef = useRef<HTMLDivElement>(null);
  const bentoGridRef = useRef<HTMLDivElement>(null);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
  const [isStartModesOpen, setIsStartModesOpen] = useState(false);
  const [isTestLabOpen, setIsTestLabOpen] = useState(false);
  const [isDuelOpen, setIsDuelOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authNickname, setAuthNickname] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [verificationSession, setVerificationSession] =
    useState<VerificationStartResponse | null>(null);
  const [verificationDetected, setVerificationDetected] = useState({
    blink: 0,
    left: 0,
    right: 0,
  });
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [verificationPurpose, setVerificationPurpose] = useState<
    "register" | "anonymous" | null
  >(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationSubmitting, setVerificationSubmitting] = useState(false);
  const [verificationStarting, setVerificationStarting] = useState(false);
  const [verificationStartStatus, setVerificationStartStatus] = useState<string | null>(null);
  const [verificationSuccessOpen, setVerificationSuccessOpen] = useState(false);
  const [verifiedToken, setVerifiedToken] = useState<string | null>(null);
  const [verifiedPurpose, setVerifiedPurpose] = useState<
    "register" | "anonymous" | null
  >(null);
  const [ratingProfile, setRatingProfile] = useState<RatingProfile | null>(null);
  const [statsSummary, setStatsSummary] = useState<StatsSummary | null>(null);
  const [statsPeriodData, setStatsPeriodData] = useState<
    Partial<Record<StatsPeriodKey, StatsPeriod>>
  >({});
  const [recentForm, setRecentForm] = useState<string[]>([]);
  const [queueInfo, setQueueInfo] = useState<QueueInfo | null>(null);
  const [ratingDataLoading, setRatingDataLoading] = useState(false);
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardAvatarByUserId, setLeaderboardAvatarByUserId] =
    useState<Record<string, string | null>>({});
  const requestedLeaderboardAvatarIdsRef = useRef<Set<string>>(new Set());
  const [resultSoundOptions, setResultSoundOptions] = useState<ResultSoundOption[]>([]);
  const [resultSoundLoading, setResultSoundLoading] = useState(false);
  const [profileUserID, setProfileUserID] = useState<string | null>(null);
  const [backendDownMessage, setBackendDownMessage] = useState<string | null>(null);
  const [legalModal, setLegalModal] = useState<"rules" | "privacy" | null>(null);
  const [showEntryChoice, setShowEntryChoice] = useState(false);
  const [showAnonymousProgressPrompt, setShowAnonymousProgressPrompt] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [tokens, setTokens] = useState<AuthTokens | null>(null);
  const [me, setMe] = useState<AuthUser | null>(null);
  const [chatCustomization] = useState<ChatCustomization>(
    defaultChatCustomization,
  );
  const [chatCatalog, setChatCatalog] = useState<ChatCustomizationCatalog | null>(null);
  const [chatSelection, setChatSelection] =
    useState<ChatCustomizationSelection | null>(null);
  const [chatCustomizationLoading, setChatCustomizationLoading] = useState(false);
  const [chatCustomizationSaving, setChatCustomizationSaving] = useState(false);
  const [chatCustomizationError, setChatCustomizationError] = useState<string | null>(null);
  const [gameCustomization, setGameCustomization] = useState<GameCustomization>(
    defaultGameCustomization,
  );
  const [resultSoundEnabled, setResultSoundEnabled] = useState(true);
  const [resultSoundVolume, setResultSoundVolume] = useState(0.8);
  const [chatBlurred, setChatBlurred] = useState(false);
  const isAnonymousUser = Boolean(
    me?.is_anonymous || me?.type === "anonymous",
  );
  const currentNickname =
    (me?.nickname && String(me.nickname)) ||
    (isAnonymousUser ? "ANONYMOUS" : "GUEST");
  const isCurrentUserAdmin = isAdminRole(typeof me?.role === "string" ? me.role : null);
  const statsSnapshot = buildStatsSnapshot(ratingProfile, statsSummary);
  const currentChatStyle = getSelectedChatStyle(chatCatalog, chatSelection);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    const warmup = () => {
      if (cancelled) return;
      void preloadFaceLandmarker().catch(() => {
        // Verification and Test Lab expose retry UI if the warmup fails.
      });
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let handle: number;
    if (idleWindow.requestIdleCallback) {
      handle = idleWindow.requestIdleCallback(warmup, { timeout: 3000 });
      return () => {
        cancelled = true;
        idleWindow.cancelIdleCallback?.(handle);
      };
    }
    handle = window.setTimeout(warmup, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Scroll to top on mobile on initial load
    const isMobile = window.innerWidth < 1024;
    if (isMobile && bentoGridRef.current) {
      bentoGridRef.current.scrollTop = 0;
    }
    setConsentAccepted(window.localStorage.getItem(CONSENT_ACCEPTED_KEY) === "1");
    const storedSoundEnabled = window.localStorage.getItem(RESULT_SOUND_ENABLED_KEY);
    const storedSoundVolume = window.localStorage.getItem(RESULT_SOUND_VOLUME_KEY);
    if (storedSoundEnabled !== null) {
      setResultSoundEnabled(storedSoundEnabled === "1");
    }
    if (storedSoundVolume !== null) {
      const parsed = Number(storedSoundVolume);
      if (Number.isFinite(parsed)) {
        setResultSoundVolume(Math.max(0, Math.min(1, parsed)));
      }
    }
    setChatBlurred(window.localStorage.getItem(CHAT_BLUR_KEY) === "1");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncTokens = () => {
      const nextTokens = loadTokens();
      setTokens(nextTokens);
      if (!nextTokens) {
        setMe(null);
        setRatingProfile(null);
        setStatsSummary(null);
        setStatsPeriodData({});
        setRecentForm([]);
        setQueueInfo(null);
        setLeaderboardEntries([]);
        setLeaderboardAvatarByUserId({});
        setChatCatalog(null);
        setChatSelection(null);
        setChatCustomizationError(null);
      }
    };

    window.addEventListener(AUTH_TOKENS_CHANGED_EVENT, syncTokens as EventListener);
    return () => {
      window.removeEventListener(AUTH_TOKENS_CHANGED_EVENT, syncTokens as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CONSENT_ACCEPTED_KEY, consentAccepted ? "1" : "0");
  }, [consentAccepted]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(RESULT_SOUND_ENABLED_KEY, resultSoundEnabled ? "1" : "0");
  }, [resultSoundEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(RESULT_SOUND_VOLUME_KEY, String(resultSoundVolume));
  }, [resultSoundVolume]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHAT_BLUR_KEY, chatBlurred ? "1" : "0");
  }, [chatBlurred]);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    let firstCheck: number | null = null;
    let intervalId: number | null = null;

    const checkHealth = async () => {
      try {
        const result = await getApiHealth(controller.signal);
        if (!mounted) return;
        if (!result.httpOk || result.health?.ok === false || result.health?.status === "degraded") {
          setBackendDownMessage("Some backend services are unavailable right now. Please reload the page and try again.");
          return;
        }
        setBackendDownMessage(null);
      } catch {
        if (!mounted) return;
        setBackendDownMessage("The backend is not responding right now. Please reload the page and try again.");
      }
    };

    firstCheck = window.setTimeout(() => {
      void checkHealth();
      intervalId = window.setInterval(() => {
        void checkHealth();
      }, 20000);
    }, 1500);

    return () => {
      mounted = false;
      controller.abort();
      if (firstCheck) window.clearTimeout(firstCheck);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initAuth = async () => {
      setAuthLoading(true);
      setAuthError(null);
      try {
        let activeTokens = loadTokens();
        if (!activeTokens) {
          const hasSeenEntry =
            typeof window !== "undefined" &&
            window.localStorage.getItem(ENTRY_SEEN_KEY) === "1";
          if (!cancelled) {
            setShowEntryChoice(!hasSeenEntry);
            setAuthLoading(false);
          }
          return;
        }

        let profile: AuthUser | null = null;
        try {
          profile = await getMe(activeTokens.accessToken);
        } catch {
          const refreshed = await authRefresh(activeTokens.refreshToken);
          activeTokens = refreshed.tokens;
          saveTokens(activeTokens);
          profile = refreshed.user ?? (await getMe(activeTokens.accessToken));
        }

        if (!cancelled) {
          setTokens(activeTokens);
          setMe(profile);
        }
      } catch (error) {
        if (!cancelled) {
          setAuthError(error instanceof Error ? error.message : "Auth error");
        }
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    };

    void initAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!tokens?.accessToken) {
      setChatCatalog(null);
      setChatSelection(null);
      return;
    }

    let cancelled = false;
    setChatCustomizationLoading(true);
    setChatCustomizationError(null);

    void Promise.all([
      getChatCustomizationCatalog(tokens.accessToken),
      getMyChatCustomization(tokens.accessToken),
    ])
      .then(([catalog, selection]) => {
        if (cancelled) return;
        setChatCatalog(catalog);
        setChatSelection(selection);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setChatCatalog(null);
        setChatSelection(null);
        setChatCustomizationError(
          error instanceof Error
            ? error.message
            : "Failed to load chat customization",
        );
      })
      .finally(() => {
        if (!cancelled) setChatCustomizationLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tokens?.accessToken]);

  const refreshRatingData = useCallback(
    async (
      accessToken: string,
      options?: {
        includePeriods?: boolean;
        includeLeaderboard?: boolean;
        setLoading?: boolean;
        isCancelled?: () => boolean;
      },
    ) => {
      const includePeriods = options?.includePeriods ?? false;
      const includeLeaderboard = options?.includeLeaderboard ?? true;
      const shouldCancel = options?.isCancelled ?? (() => false);
      if (options?.setLoading) {
        setRatingDataLoading(true);
        if (includeLeaderboard) setLeaderboardLoading(true);
      }

      try {
        const [
          myRating,
          summary,
          recentFormData,
          matchesData,
          queueInfoData,
          leaderboard,
          todayPeriod,
          weekPeriod,
          seasonPeriod,
        ] = await Promise.all([
          getMyRating(accessToken),
          getStatsSummary(accessToken),
          getRecentForm(accessToken, 5),
          getMyMatches(accessToken, 1),
          getQueueInfo(accessToken),
          includeLeaderboard
            ? getLeaderboard(accessToken, 20)
            : Promise.resolve<LeaderboardEntry[] | null>(null),
          includePeriods
            ? getStatsPeriod(accessToken, "today")
            : Promise.resolve<StatsPeriod | null>(null),
          includePeriods
            ? getStatsPeriod(accessToken, "week")
            : Promise.resolve<StatsPeriod | null>(null),
          includePeriods
            ? getStatsPeriod(accessToken, "season")
            : Promise.resolve<StatsPeriod | null>(null),
        ]);
        if (shouldCancel()) return null;

        setRatingProfile(myRating);
        setStatsSummary(summary);
        setRecentForm(recentFormData);
        setQueueInfo(queueInfoData);
        if (includeLeaderboard && leaderboard) {
          setLeaderboardEntries(leaderboard);
        }
        if (includePeriods) {
          setStatsPeriodData({
            today: todayPeriod ?? undefined,
            week: weekPeriod ?? undefined,
            season: seasonPeriod ?? undefined,
          });
        }

        return matchesData.matches[0] ?? null;
      } catch {
        if (shouldCancel()) return null;
        setRatingProfile(null);
        setStatsSummary(null);
        setStatsPeriodData({});
        setRecentForm([]);
        setQueueInfo(null);
        if (includeLeaderboard) {
          setLeaderboardEntries([]);
          setLeaderboardAvatarByUserId({});
        }
        return null;
      } finally {
        if (!shouldCancel() && options?.setLoading) {
          setRatingDataLoading(false);
          if (includeLeaderboard) setLeaderboardLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!tokens?.accessToken) {
      setRatingDataLoading(false);
      setRatingProfile(null);
      setStatsSummary(null);
      setStatsPeriodData({});
      setRecentForm([]);
      setQueueInfo(null);
      setLeaderboardEntries([]);
      setLeaderboardAvatarByUserId({});
      setLeaderboardLoading(false);
      setResultSoundOptions([]);
      setResultSoundLoading(false);
      return;
    }

    let cancelled = false;
    void refreshRatingData(tokens.accessToken, {
      includePeriods: true,
      setLoading: true,
      isCancelled: () => cancelled,
    });
    return () => {
      cancelled = true;
    };
  }, [refreshRatingData, tokens?.accessToken]);

  useEffect(() => {
    if (!tokens?.accessToken) {
      setResultSoundOptions([]);
      setResultSoundLoading(false);
      return;
    }

    let cancelled = false;

    const loadSounds = async () => {
      setResultSoundLoading(true);
      try {
        const sounds = await getResultSounds(tokens.accessToken);
        if (cancelled) return;
        setResultSoundOptions(sounds);
        const selected = sounds.find((sound) => sound.selected);
        if (selected) {
          setGameCustomization((current) => ({
            ...current,
            victorySound: selected.title,
          }));
        }
      } catch {
        if (cancelled) return;
        setResultSoundOptions([]);
      } finally {
        if (!cancelled) setResultSoundLoading(false);
      }
    };

    void loadSounds();
    return () => {
      cancelled = true;
    };
  }, [tokens?.accessToken]);

  useEffect(() => {
    if (!tokens?.accessToken || !leaderboardEntries.length) return;
    const missingIds = leaderboardEntries
      .filter(
        (entry) =>
          !entry.avatar_url &&
          !(entry.user_id in leaderboardAvatarByUserId) &&
          !requestedLeaderboardAvatarIdsRef.current.has(entry.user_id),
      )
      .map((entry) => entry.user_id);
    const uniqueIds = Array.from(new Set(missingIds));
    if (!uniqueIds.length) return;
    uniqueIds.forEach((id) => requestedLeaderboardAvatarIdsRef.current.add(id));

    let cancelled = false;
    void Promise.all(
      uniqueIds.map(async (id) => {
        const profile = await getPublicProfile(tokens.accessToken, id).catch(() => null);
        return [id, profile?.avatar_url ?? ""] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setLeaderboardAvatarByUserId((current) => ({
        ...current,
        ...Object.fromEntries(entries.map(([id, avatarUrl]) => [id, avatarUrl || null])),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [leaderboardAvatarByUserId, leaderboardEntries, tokens?.accessToken]);

  const handleSelectResultSound = useCallback(
    async (sound: ResultSoundOption) => {
      if (!tokens?.accessToken || !sound.owned) return;
      try {
        const nextSounds = await selectResultSound(tokens.accessToken, sound.id);
        if (nextSounds) {
          setResultSoundOptions(nextSounds);
          const selected = nextSounds.find((item) => item.selected) ?? sound;
          setGameCustomization((current) => ({
            ...current,
            victorySound: selected.title,
          }));
          return;
        }
        setResultSoundOptions((current) =>
          current.map((item) => ({
            ...item,
            selected: item.id === sound.id,
          })),
        );
        setGameCustomization((current) => ({
          ...current,
          victorySound: sound.title,
        }));
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : "Failed to select result sound");
      }
    },
    [tokens?.accessToken],
  );

  const handleSelectChatCustomization = useCallback(
    async (slot: ChatCustomizationSlot, item: ChatCustomizationItem) => {
      if (!tokens?.accessToken || !item.owned) return;
      setChatCustomizationSaving(true);
      setChatCustomizationError(null);
      try {
        const nextSelection = await selectChatCustomizationItem(
          tokens.accessToken,
          slot,
          item.id,
        );
        setChatSelection(nextSelection);
        setChatCatalog((current) => {
          if (!current) return current;
          const slotKey =
            slot === "title"
              ? "titles"
              : slot === "nickname_color"
                ? "nickname_colors"
                : slot === "text_style"
                  ? "text_styles"
                  : slot === "title_frame"
                    ? "title_frames"
                    : slot === "avatar"
                      ? "avatars"
                      : "badges";
          return {
            ...current,
            [slotKey]: current[slotKey].map((entry) => ({
              ...entry,
              selected:
                slot === "badge"
                  ? Boolean(nextSelection.badge_ids?.includes(entry.id))
                  : entry.id === item.id,
            })),
          };
        });
      } catch (error) {
        setChatCustomizationError(
          error instanceof Error ? error.message : "Failed to select chat item",
        );
      } finally {
        setChatCustomizationSaving(false);
      }
    },
    [tokens?.accessToken],
  );

  const handleClearChatCustomization = useCallback(
    async (slot: ChatCustomizationSlot) => {
      if (!tokens?.accessToken) return;
      setChatCustomizationSaving(true);
      setChatCustomizationError(null);
      try {
        const nextSelection = await clearChatCustomizationSlot(tokens.accessToken, slot);
        setChatSelection(nextSelection);
      } catch (error) {
        setChatCustomizationError(
          error instanceof Error ? error.message : "Failed to clear chat slot",
        );
      } finally {
        setChatCustomizationSaving(false);
      }
    },
    [tokens?.accessToken],
  );

  useEffect(() => {
    if (!isStatsOpen && !isCustomizeOpen && !isStartModesOpen && !isTestLabOpen && !isDuelOpen && !isAuthOpen && !isAdminOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isTestLabOpen) {
          return;
        }
        setIsStatsOpen(false);
        setIsCustomizeOpen(false);
        setIsStartModesOpen(false);
        setIsDuelOpen(false);
        setIsAuthOpen(false);
        setIsAdminOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isStatsOpen, isCustomizeOpen, isStartModesOpen, isTestLabOpen, isDuelOpen, isAuthOpen, isAdminOpen]);

  const completeRegisteredAuth = useCallback(async (verificationTokenValue?: string) => {
    const nickname = authNickname.trim();
    const password = authPassword.trim();
    if (!nickname || !password) {
      throw new Error("Nickname and password are required");
    }

    let result: { tokens: AuthTokens; user: AuthUser | null };
    if (isAnonymousUser && tokens) {
      result = await authUpgrade(tokens.accessToken, nickname, password);
    } else {
      if (!verificationTokenValue) {
        throw new Error("Complete webcam verification first");
      }
      result = await authRegister(nickname, password, verificationTokenValue);
    }

    saveTokens(result.tokens);
    setTokens(result.tokens);
    const profile = result.user ?? (await getMe(result.tokens.accessToken));
    setMe(profile);
    setAuthPassword("");
    setVerificationToken(null);
    setVerifiedToken(null);
    setVerifiedPurpose(null);
    setIsAuthOpen(false);
    setShowEntryChoice(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ENTRY_SEEN_KEY, "1");
    }
  }, [authNickname, authPassword, isAnonymousUser, tokens]);

  const handleAuthSubmit = async () => {
    if (authMode !== "login" && !consentAccepted) {
      setAuthError("Accept the rules, privacy policy, 18+ confirmation, and data processing terms");
      return;
    }

    const nickname = authNickname.trim();
    const password = authPassword.trim();
    if (!nickname || !password) {
      setAuthError("Nickname and password are required");
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    try {
      let result: { tokens: AuthTokens; user: AuthUser | null };
      if (authMode === "login") {
        result = await authLogin(nickname, password);
      } else {
        if (isAnonymousUser && tokens) {
          await completeRegisteredAuth();
          return;
        }
        if (!verifiedToken) {
          setAuthLoading(false);
          void handleStartVerification("register");
          return;
        }
        await completeRegisteredAuth(verifiedToken);
        return;
      }

      saveTokens(result.tokens);
      setTokens(result.tokens);
      const profile = result.user ?? (await getMe(result.tokens.accessToken));
      setMe(profile);
      setAuthPassword("");
      setVerificationToken(null);
      setVerifiedToken(null);
      setIsAuthOpen(false);
      setShowEntryChoice(false);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ENTRY_SEEN_KEY, "1");
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Auth failed");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleStartVerification = async (purpose: "register" | "anonymous") => {
    setVerificationError(null);
    setVerificationStarting(true);
    setVerificationStartStatus("Contacting verification service...");
    setVerifiedToken(null);
    setVerificationToken(null);
    setVerifiedPurpose(null);
    try {
      const session = await verificationStart();
      setVerificationStartStatus("Verification session created. Opening camera...");
      setVerificationPurpose(purpose);
      setVerificationDetected({ blink: 0, left: 0, right: 0 });
      setVerificationSession(session);
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "Verification start failed",
      );
      setVerificationStartStatus(null);
    } finally {
      setVerificationStarting(false);
    }
  };

  const handleSubmitVerification = async () => {
    if (!verificationSession) return;
    setVerificationSubmitting(true);
    setVerificationError(null);
    try {
      const token = await verificationSubmit({
        verification_session_id: verificationSession.verification_session_id,
        detected_blink_count: verificationDetected.blink,
        detected_turn_left: verificationDetected.left,
        detected_turn_right: verificationDetected.right,
      });
      setVerifiedToken(token);
      setVerificationToken(token);
      setVerifiedPurpose(verificationPurpose);
      setVerificationSession(null);
      setVerificationPurpose(null);
      setVerificationStartStatus(null);
      setVerificationSuccessOpen(true);
    } catch (error) {
      setVerificationError(
        error instanceof Error ? error.message : "Verification submit failed",
      );
    } finally {
      setVerificationSubmitting(false);
    }
  };

  const handleVerificationSuccessContinue = async () => {
    setVerificationSuccessOpen(false);
    if (!verifiedToken) return;

    if (verifiedPurpose === "anonymous") {
      setAuthLoading(true);
      setAuthError(null);
      try {
        const result = await authAnonymous(verifiedToken);
        saveTokens(result.tokens);
        setTokens(result.tokens);
        const profile = result.user ?? (await getMe(result.tokens.accessToken));
        setMe(profile);
        setShowEntryChoice(false);
        setVerificationToken(null);
        setVerifiedToken(null);
        setVerifiedPurpose(null);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(ENTRY_SEEN_KEY, "1");
        }
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : "Anonymous auth failed");
        setShowEntryChoice(true);
      } finally {
        setAuthLoading(false);
      }
      return;
    }

    if (verifiedPurpose === "register") {
      setAuthLoading(true);
      setAuthError(null);
      try {
        await completeRegisteredAuth(verifiedToken);
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : "Auth failed");
      } finally {
        setAuthLoading(false);
      }
    }
  };

  const handleLogout = async () => {
    if (!tokens) return;
    setAuthLoading(true);
    setAuthError(null);
    try {
      await authLogout(tokens.refreshToken);
      saveTokens(null);
      setTokens(null);
      setMe(null);
      setRatingDataLoading(false);
      setRatingProfile(null);
      setStatsSummary(null);
      setStatsPeriodData({});
      setRecentForm([]);
      setQueueInfo(null);
      setLeaderboardEntries([]);
      setLeaderboardAvatarByUserId({});
      setShowEntryChoice(true);
      setAuthMode("login");
      setAuthNickname("");
      setAuthPassword("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Logout failed");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleContinueAnonymous = () => {
    if (!consentAccepted) return;
    setShowEntryChoice(false);
    void handleStartVerification("anonymous");
  };

  const handleAnonymousGameFinished = useCallback(() => {
    if (!isAnonymousUser) return;
    setShowAnonymousProgressPrompt(true);
  }, [isAnonymousUser]);

  const refreshGameplayData = useCallback(async () => {
    if (!tokens?.accessToken) return null;
    const latest = await refreshRatingData(tokens.accessToken, {
      includePeriods: true,
      includeLeaderboard: true,
    });
    window.setTimeout(() => {
      if (!tokens.accessToken) return;
      void refreshRatingData(tokens.accessToken, {
        includePeriods: true,
        includeLeaderboard: true,
      });
    }, 1800);
    return latest;
  }, [refreshRatingData, tokens]);

  const handleDuelFinished = useCallback(async () => {
    const latest = await refreshGameplayData();
    handleAnonymousGameFinished();
    return latest;
  }, [handleAnonymousGameFinished, refreshGameplayData]);

  const openAuthFromAnonymousPrompt = useCallback((mode: "login" | "register") => {
    setShowAnonymousProgressPrompt(false);
    setShowEntryChoice(false);
    setAuthError(null);
    setAuthMode(mode);
    setIsAuthOpen(true);
  }, []);

  const handleAnonymousNicknameClick = useCallback(() => {
    setShowEntryChoice(false);
    setShowAnonymousProgressPrompt(false);
    setAuthError(null);
    setAuthMode("register");
    setIsAuthOpen(true);
  }, []);

  const handleGuestNicknameClick = useCallback(() => {
    setShowAnonymousProgressPrompt(false);
    setAuthError(null);
    setShowEntryChoice(true);
    setIsAuthOpen(false);
  }, []);

  const handleOpenProfile = useCallback(
    (userID?: string | null) => {
      if (!tokens?.accessToken) {
        handleGuestNicknameClick();
        return;
      }
      const fallbackID = me?.id ? String(me.id) : null;
      const nextID = userID ?? fallbackID;
      if (nextID) setProfileUserID(nextID);
    },
    [handleGuestNicknameClick, me?.id, tokens?.accessToken],
  );

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-auto absolute inset-0 opacity-55">
        <PixelBlast
          variant="square"
          pixelSize={4}
          color="#B497CF"
          patternScale={2}
          patternDensity={1}
          pixelSizeJitter={0}
          enableRipples
          rippleSpeed={0.4}
          rippleThickness={0.12}
          rippleIntensityScale={1.5}
          liquid={false}
          liquidStrength={0.12}
          liquidRadius={1.2}
          liquidWobbleSpeed={5}
          speed={0.5}
          edgeFade={0.25}
          transparent
        />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.32)_48%,rgba(0,0,0,0.82)_100%)]" />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
        <nav className="flex min-h-14 items-center justify-center border border-border bg-zinc-950/85 shadow-wire backdrop-blur-sm">
          <div className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400 sm:grid-cols-[1fr_auto_1fr] sm:gap-0 sm:px-4 sm:text-sm">
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 justify-self-start border border-zinc-700 bg-black/70 px-2 text-[9px] font-semibold tracking-[0.12em] text-zinc-300 transition-colors hover:border-purple-400/55 hover:text-zinc-100 sm:gap-2 sm:px-2.5 sm:text-[10px]"
              aria-label="Guide for SUB5"
            >
              <CircleHelp className="h-3 w-3 text-purple-300 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Guide for SUB5</span>
              <span className="sm:hidden">Guide</span>
            </button>
            <div className="flex items-center justify-center gap-3 sm:grid sm:grid-cols-[auto_auto_auto] sm:items-center sm:gap-7">
              <a className="hidden transition-colors hover:text-zinc-100 sm:inline" href="#community">
                Community
              </a>
              <Shuffle
                text="CHADCHAT"
                shuffleDirection="right"
                duration={0.35}
                animationMode="evenodd"
                shuffleTimes={1}
                ease="power3.out"
                stagger={0.03}
                threshold={0.1}
                triggerOnce
                triggerOnHover
                respectReducedMotion
                loop={false}
                loopDelay={0}
                tag="span"
                className="nav-logo text-sm text-zinc-100 sm:text-base"
              />
              <a
                className="hidden items-center gap-2 transition-colors hover:text-zinc-100 sm:grid sm:grid-cols-[auto_16px]"
                href="#shop"
              >
                Shop
                <ShoppingBag className="h-4 w-4 text-zinc-600" aria-hidden="true" />
              </a>
            </div>
            <div
              className={cn(
                "flex h-8 items-center gap-1.5 justify-self-end border border-zinc-700 bg-black/70 px-2 text-zinc-200 transition-all sm:gap-2 sm:px-2.5",
                "shadow-[0_0_12px_rgba(132,0,255,0.08)]",
              )}
            >
              <button
                type="button"
                onClick={() => {
                  if (isAnonymousUser) {
                    handleAnonymousNicknameClick();
                    return;
                  }
                  if (!tokens) {
                    handleGuestNicknameClick();
                    return;
                  }
                  handleOpenProfile();
                }}
                className="inline-flex h-5 items-center gap-1 border border-zinc-700 bg-zinc-900/60 px-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-300 transition-colors hover:border-purple-500/60 hover:text-zinc-100 sm:px-2 sm:text-[10px]"
              >
                <User className="h-3 w-3" aria-hidden="true" />
                <span className="max-w-[4rem] truncate sm:max-w-none">{authLoading ? "..." : currentNickname}</span>
              </button>
              {isCurrentUserAdmin && (
                <AdminBadge
                  className="h-5 px-1.5 text-[7px] sm:px-2 sm:text-[8px]"
                  onClick={() => setIsAdminOpen(true)}
                />
              )}
              {!isAnonymousUser && (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex h-5 w-5 items-center justify-center border border-zinc-700 bg-zinc-900/60 text-zinc-400 transition-colors hover:border-red-500/60 hover:text-red-300"
                  aria-label="Logout"
                >
                  <LogOut className="h-3 w-3 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </nav>

        <GlobalSpotlight
          gridRef={bentoGridRef}
          enabled
          spotlightRadius={400}
          glowColor={magicGlow}
        />
        <div
          ref={bentoGridRef}
          className="bento-section grid flex-1 gap-4 overflow-y-auto overscroll-contain scroll-smooth py-4 lg:grid-cols-[minmax(180px,1fr)_minmax(280px,420px)_minmax(180px,1fr)]"
        >
          {/* Mobile: Stats/Customize/Start first, then Tops, then Chat */}
          {/* Desktop: Chat | Center | Leaderboard (via order) */}

          <ParticleCard
            className={cn(
              magicBlockClass,
              "order-1 h-[calc(100vh-7.5rem)] min-h-[320px] overflow-hidden shadow-wire backdrop-blur-sm lg:order-2",
            )}
            particleCount={12}
            glowColor={magicGlow}
            enableTilt={false}
            enableMagnetism={false}
            clickEffect
          >
            <section className="flex h-full min-h-0 flex-col justify-center gap-4 border border-border p-4 sm:p-6">
              <MagicButton className="h-72 w-full sm:h-80">
                <StatsPanel
                  onOpenDetails={() => setIsStatsOpen(true)}
                  stats={statsSnapshot}
                  loading={ratingDataLoading}
                />
              </MagicButton>
              <MagicButton className="h-20 w-full">
                <Button
                  size="wireMedium"
                  variant="outline"
                  className="h-full gap-3"
                  onClick={() => setIsCustomizeOpen(true)}
                >
                  <UserRoundCog className="h-5 w-5" aria-hidden="true" />
                  Customize
                </Button>
              </MagicButton>
              <div ref={startButtonRef} className="relative h-14 overflow-hidden">
                <div className={cn("h-full border p-[2px]", getGameFrameClass(gameCustomization.frame))}>
                  <MagicButton className="h-full w-full">
                    <Button
                      size="wireSmall"
                      className="h-full gap-3 bg-zinc-100 text-black hover:bg-white hover:text-black"
                      onClick={() => setIsStartModesOpen(true)}
                    >
                      Start Mogging
                    </Button>
                  </MagicButton>
                </div>
                <Crosshair
                  containerRef={startButtonRef}
                  color="#c084fc"
                  glowColor="#a855f7"
                />
              </div>
            </section>
          </ParticleCard>

          <Panel title="Tops" icon={<Trophy className="h-4 w-4" />} className="order-2 lg:order-3">
            <TopsLeaderboard
              entries={leaderboardEntries}
              loading={leaderboardLoading}
              onOpenProfile={handleOpenProfile}
              avatarByUserId={leaderboardAvatarByUserId}
            />
          </Panel>

          <Panel
            title="Live Chat"
            icon={<MessageSquare className="h-4 w-4" />}
            className="order-3 lg:order-1"
            headerAction={
              <button
                type="button"
                onClick={() => setChatBlurred((current) => !current)}
                className="inline-flex h-6 items-center justify-center border border-zinc-800 bg-black/70 px-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-300 transition-colors hover:border-purple-400 hover:text-white"
              >
                {chatBlurred ? "Unblur" : "Blur"}
              </button>
            }
          >
            <LiveChat
              chatCustomization={chatCustomization}
              currentChatStyle={currentChatStyle}
              currentUserName={currentNickname}
              currentUserRole={typeof me?.role === "string" ? me.role : undefined}
              accessToken={tokens?.accessToken ?? null}
              chatBlurred={chatBlurred}
              onOpenProfile={handleOpenProfile}
            />
          </Panel>
        </div>
      </div>
      {isStatsOpen && statsSnapshot && (
        <StatsModal
          onClose={() => setIsStatsOpen(false)}
          stats={statsSnapshot}
          periodApiData={statsPeriodData}
          recentForm={recentForm}
          queueInfo={queueInfo}
        />
      )}
      {isCustomizeOpen && (
        <CustomizeModal
          chatCustomization={chatCustomization}
          chatCatalog={chatCatalog}
          chatSelection={chatSelection}
          chatCustomizationLoading={chatCustomizationLoading}
          chatCustomizationSaving={chatCustomizationSaving}
          chatCustomizationError={chatCustomizationError}
          resultSoundOptions={resultSoundOptions}
          resultSoundLoading={resultSoundLoading}
          resultSoundVolume={resultSoundVolume}
          onSelectChatCustomization={handleSelectChatCustomization}
          onClearChatCustomization={handleClearChatCustomization}
          onChangeResultSoundVolume={setResultSoundVolume}
          onSelectResultSound={handleSelectResultSound}
          onClose={() => setIsCustomizeOpen(false)}
        />
      )}
      {profileUserID && (
        <ProfileModal
          accessToken={tokens?.accessToken ?? null}
          userID={profileUserID}
          myUserID={me?.id ? String(me.id) : null}
          currentUserRole={typeof me?.role === "string" ? me.role : undefined}
          onClose={() => setProfileUserID(null)}
          onProfileUpdated={(profile) => {
            setMe((current) =>
              current
                ? {
                    ...current,
                    nickname: profile.nickname ?? current.nickname,
                  }
                : current,
            );
          }}
        />
      )}
      {isStartModesOpen && (
        <StartModesModal
          onClose={() => setIsStartModesOpen(false)}
          onOpenTestLab={() => setIsTestLabOpen(true)}
          onOpenDuel={() => setIsDuelOpen(true)}
        />
      )}
      {isTestLabOpen && (
        <TestLabModal
          accessToken={tokens?.accessToken ?? null}
          onClose={(completed) => {
            setIsTestLabOpen(false);
            if (completed) {
              void refreshGameplayData();
              handleAnonymousGameFinished();
            }
          }}
        />
      )}
      {isDuelOpen && (
        <DuelModal
          accessToken={tokens?.accessToken ?? null}
          myUserId={me?.id ? String(me.id) : null}
          resultSoundEnabled={resultSoundEnabled}
          resultSoundVolume={resultSoundVolume}
          onFinished={handleDuelFinished}
          onClose={() => setIsDuelOpen(false)}
        />
      )}
      {isAuthOpen && (
        <AuthModal
          mode={authMode}
          setMode={setAuthMode}
          nickname={authNickname}
          password={authPassword}
          onNickname={setAuthNickname}
          onPassword={setAuthPassword}
          onSubmit={handleAuthSubmit}
          onClose={() => {
            setIsAuthOpen(false);
            if (!tokens) setShowEntryChoice(true);
          }}
          isAnonymous={isAnonymousUser}
          isSubmitting={authLoading}
          error={authError}
          verificationToken={verificationToken}
          consentAccepted={consentAccepted}
          onConsentChange={setConsentAccepted}
          onOpenRules={() => setLegalModal("rules")}
          onOpenPrivacy={() => setLegalModal("privacy")}
        />
      )}
      {verificationSession && (
        <VerificationModal
          session={verificationSession}
          detected={verificationDetected}
          setDetected={setVerificationDetected}
          onSubmit={handleSubmitVerification}
          onClose={() => {
            if (!tokens && verificationPurpose === "anonymous") {
              setShowEntryChoice(true);
            }
            setVerificationSession(null);
            setVerificationPurpose(null);
            setVerificationStartStatus(null);
          }}
          isSubmitting={verificationSubmitting}
          error={verificationError}
        />
      )}
      {verificationStarting && !verificationSession && (
        <VerificationStartingModal status={verificationStartStatus} />
      )}
      {verificationSuccessOpen && (
        <VerificationSuccessModal
          onContinue={() => void handleVerificationSuccessContinue()}
        />
      )}
      {showEntryChoice && (
        <EntryChoiceModal
          onAnonymous={handleContinueAnonymous}
          onLogin={() => {
            setShowEntryChoice(false);
            setAuthMode("login");
            setAuthError(null);
            setIsAuthOpen(true);
          }}
          onRegister={() => {
            setShowEntryChoice(false);
            setAuthMode("register");
            setAuthError(null);
            setVerificationToken(null);
            setIsAuthOpen(true);
          }}
          isStartingVerification={verificationStarting}
          verificationStartStatus={verificationStartStatus}
          consentAccepted={consentAccepted}
          onConsentChange={setConsentAccepted}
          onOpenRules={() => setLegalModal("rules")}
          onOpenPrivacy={() => setLegalModal("privacy")}
        />
      )}
      {legalModal && (
        <LegalModal
          kind={legalModal}
          onClose={() => setLegalModal(null)}
        />
      )}
      {showAnonymousProgressPrompt && (
        <AnonymousProgressModal
          onLogin={() => openAuthFromAnonymousPrompt("login")}
          onRegister={() => openAuthFromAnonymousPrompt("register")}
          onClose={() => setShowAnonymousProgressPrompt(false)}
        />
      )}
      {backendDownMessage && (
        <BackendStatusModal
          message={backendDownMessage}
        />
      )}
      {isAdminOpen && (
        <AdminModal onClose={() => setIsAdminOpen(false)} />
      )}
    </main>
  );
}
