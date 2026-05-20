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

export function ProfileModal({
  accessToken,
  userID,
  myUserID,
  currentUserRole,
  onClose,
  onProfileUpdated,
}: {
  accessToken: string | null;
  userID: string | null;
  myUserID: string | null;
  currentUserRole?: string;
  onClose: () => void;
  onProfileUpdated?: (profile: Profile) => void;
}) {
  const isMine = Boolean(userID && myUserID && userID === myUserID);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [comments, setComments] = useState<ProfileComment[]>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [loading, setLoading] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [deletingCommentID, setDeletingCommentID] = useState<string | null>(null);
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
  const [editBio, setEditBio] = useState("");
  const [editCountry, setEditCountry] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadComments = useCallback(
    async (cursor?: string) => {
      if (!accessToken || !userID) return;
      setCommentsLoading(true);
      try {
        const result = await getProfileComments(accessToken, userID, 20, cursor);
        setComments((current) =>
          cursor ? [...current, ...result.comments] : result.comments,
        );
        setNextCursor(result.nextCursor);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to load comments");
      } finally {
        setCommentsLoading(false);
      }
    },
    [accessToken, userID],
  );

  useEffect(() => {
    if (!accessToken || !userID) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setComments([]);
    setNextCursor("");

    const run = async () => {
      try {
        const loaded = isMine
          ? await getMyProfile(accessToken)
          : await getPublicProfile(accessToken, userID);
        if (cancelled) return;
        setProfile(loaded);
        setEditBio(loaded?.bio ?? "");
        setEditCountry(loaded?.country_code ?? "");
        setAvatarFile(null);
        await loadComments();
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : "Failed to load profile");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [accessToken, userID, isMine, loadComments]);

  const saveProfile = async () => {
    if (!accessToken || !isMine) return;
    setSaving(true);
    setError(null);
    try {
      let avatarUrl = profile?.avatar_url ?? "";
      if (avatarFile) {
        const upload = await createAvatarUpload(accessToken, {
          file_name: avatarFile.name,
          content_type: avatarFile.type,
          file_size: avatarFile.size,
        });
        const uploadResponse = await fetch(upload.upload_url, {
          method: upload.method ?? "PUT",
          headers: upload.headers ?? { "Content-Type": avatarFile.type },
          body: avatarFile,
        });
        if (!uploadResponse.ok) {
          throw new Error(`Avatar upload failed: ${uploadResponse.status}`);
        }
        avatarUrl = upload.file_url;
      }
      const updated = await updateMyProfile(accessToken, {
        avatar_url: avatarUrl,
        country_code: editCountry.trim().toUpperCase(),
        bio: editBio.trim(),
      });
      if (updated) {
        setProfile(updated);
        setAvatarFile(null);
        onProfileUpdated?.(updated);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const submitComment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accessToken || !userID) return;
    const text = commentDraft.trim();
    if (!text) return;
    setSaving(true);
    try {
      const comment = await postProfileComment(accessToken, userID, text);
      if (comment) setComments((current) => [comment, ...current]);
      setCommentDraft("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to post comment");
    } finally {
      setSaving(false);
    }
  };

  const submitReply = async (parentCommentID: string) => {
    if (!accessToken || !userID) return;
    const text = (replyDrafts[parentCommentID] ?? "").trim();
    if (!text) return;
    setSaving(true);
    try {
      const comment = await postProfileComment(accessToken, userID, text, parentCommentID);
      if (comment) setComments((current) => [...current, comment]);
      setReplyDrafts((current) => ({ ...current, [parentCommentID]: "" }));
      setReplyingTo(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to post reply");
    } finally {
      setSaving(false);
    }
  };

  const deleteComment = async (commentID: string) => {
    if (!accessToken || !userID) return;
    setDeletingCommentID(commentID);
    setError(null);
    try {
      await deleteProfileComment(accessToken, userID, commentID);
      setComments((current) =>
        current.map((comment) =>
          comment.id === commentID
            ? { ...comment, text: "", is_deleted: true }
            : comment,
        ),
      );
      setReplyingTo((current) => (current === commentID ? null : current));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to delete comment");
    } finally {
      setDeletingCommentID(null);
    }
  };

  const voteComment = async (commentID: string, value: number) => {
    if (!accessToken || !userID) return;
    try {
      const result = await voteProfileComment(accessToken, userID, commentID, value);
      setComments((current) =>
        current.map((comment) =>
          comment.id === commentID
            ? {
                ...comment,
                like_count: result.like_count,
                dislike_count: result.dislike_count,
                my_vote: result.my_vote,
              }
            : comment,
        ),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to vote");
    }
  };

  const progress = Math.max(0, Math.min(100, profile?.progress_percent ?? 0));
  const isAdminProfile = isAdminRole(profile?.role);
  const canModerateProfiles = isAdminRole(currentUserRole);
  const sortByPopularity = (a: ProfileComment, b: ProfileComment) =>
    b.like_count - a.like_count || Date.parse(b.created_at) - Date.parse(a.created_at);

  const rootComments = comments
    .filter((comment) => !comment.parent_comment_id)
    .sort(sortByPopularity);

  const repliesByParent = comments.reduce<Record<string, ProfileComment[]>>(
    (acc, comment) => {
      if (!comment.parent_comment_id) return acc;
      acc[comment.parent_comment_id] = [
        ...(acc[comment.parent_comment_id] ?? []),
        comment,
      ];
      return acc;
    },
    {},
  );

  Object.keys(repliesByParent).forEach((key) => {
    repliesByParent[key].sort(sortByPopularity);
  });

  const getCommentById = (id: string) => comments.find((c) => c.id === id);

  const renderComment = (comment: ProfileComment, depth = 0): React.ReactNode => {
    const replies = repliesByParent[comment.id] ?? [];
    const isReplying = replyingTo === comment.id;
    const parentComment = comment.parent_comment_id ? getCommentById(comment.parent_comment_id) : null;
    const canDelete =
      !comment.is_deleted &&
      Boolean(
        myUserID &&
          (comment.author_user_id === myUserID ||
            comment.target_user_id === myUserID ||
            canModerateProfiles),
      );
    const isDeleting = deletingCommentID === comment.id;
    const isExpanded = expandedReplies[comment.id] ?? false;
    const repliesLimit = 3;
    const hasMoreReplies = replies.length > repliesLimit;
    const visibleReplies = isExpanded ? replies : replies.slice(0, repliesLimit);
    const canVote = !comment.is_deleted && Boolean(accessToken);

    return (
      <div key={comment.id} className={cn(depth > 0 && "border-l border-purple-500/20 pl-3")}>
        <div className={cn("border bg-black/50 p-3", depth === 0 ? "border-zinc-800/80" : "border-zinc-800/50")}>
          {/* Author row */}
          <div className="flex items-start gap-2.5">
            <Avatar user={comment.author_nickname} className="h-7 w-7 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("text-[10px] font-black uppercase tracking-[0.1em]", comment.is_deleted ? "text-zinc-600" : "text-zinc-200")}>
                    {comment.author_nickname}
                  </span>
                  {parentComment && (
                    <span className="text-[9px] font-semibold text-purple-400/70">
                      ↳ @{parentComment.author_nickname}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[9px] uppercase tracking-[0.1em] text-zinc-600">
                    {formatDateShort(comment.created_at)}
                  </span>
                  {canDelete && (
                    <button
                      className="inline-flex h-5 w-5 items-center justify-center border border-red-500/30 bg-red-950/20 text-red-400 transition-colors hover:border-red-400 hover:text-red-200 disabled:cursor-wait disabled:opacity-40"
                      type="button"
                      aria-label="Delete comment"
                      disabled={isDeleting}
                      onClick={() => deleteComment(comment.id)}
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>

              {comment.is_deleted ? (
                <p className="mt-1.5 text-xs italic leading-5 text-zinc-600">Deleted comment</p>
              ) : (
                <>
                  <p className="mt-1.5 break-words text-xs leading-5 text-zinc-300">{comment.text}</p>
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[9px] font-black uppercase tracking-[0.08em] transition-all",
                        comment.my_vote === 1
                          ? "border-emerald-500/50 bg-emerald-950/30 text-emerald-300 shadow-[0_0_8px_rgba(52,211,153,0.2)]"
                          : "border-zinc-800 bg-black/40 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300",
                      )}
                      type="button"
                      disabled={!canVote}
                      onClick={() => voteComment(comment.id, comment.my_vote === 1 ? 0 : 1)}
                    >
                      <ThumbsUp className="h-3 w-3" aria-hidden="true" />
                      {comment.like_count}
                    </button>
                    <button
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[9px] font-black uppercase tracking-[0.08em] transition-all",
                        comment.my_vote === -1
                          ? "border-rose-500/50 bg-rose-950/30 text-rose-300 shadow-[0_0_8px_rgba(251,113,133,0.2)]"
                          : "border-zinc-800 bg-black/40 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300",
                      )}
                      type="button"
                      disabled={!canVote}
                      onClick={() => voteComment(comment.id, comment.my_vote === -1 ? 0 : -1)}
                    >
                      <ThumbsDown className="h-3 w-3" aria-hidden="true" />
                      {comment.dislike_count}
                    </button>
                    {depth === 0 && (
                      <button
                        className="text-[9px] font-black uppercase tracking-[0.12em] text-zinc-600 transition-colors hover:text-purple-300"
                        type="button"
                        onClick={() => setReplyingTo((cur) => cur === comment.id ? null : comment.id)}
                      >
                        Reply
                      </button>
                    )}
                  </div>
                </>
              )}

              {isReplying && (
                <div className="mt-3 flex gap-2">
                  <input
                    className="h-8 min-w-0 flex-1 border border-zinc-800 bg-black/80 px-3 text-xs text-zinc-100 outline-none focus:border-purple-400"
                    placeholder={`Reply to ${comment.author_nickname}…`}
                    maxLength={1000}
                    value={replyDrafts[comment.id] ?? ""}
                    onChange={(e) => setReplyDrafts((cur) => ({ ...cur, [comment.id]: e.target.value }))}
                  />
                  <button
                    className="h-8 border border-purple-500/50 bg-purple-950/35 px-3 text-[9px] font-black uppercase tracking-[0.12em] text-purple-100 transition-colors hover:border-purple-300 disabled:opacity-40"
                    type="button"
                    disabled={saving || !(replyDrafts[comment.id] ?? "").trim()}
                    onClick={() => submitReply(comment.id)}
                  >
                    Send
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {Boolean(visibleReplies.length) && (
          <div className="mt-2 space-y-2">
            {visibleReplies.map((reply) => renderComment(reply, depth + 1))}
            {hasMoreReplies && (
              <button
                className="pl-3 text-[9px] font-black uppercase tracking-[0.12em] text-purple-400/70 transition-colors hover:text-purple-300"
                type="button"
                onClick={() => setExpandedReplies((cur) => ({ ...cur, [comment.id]: !isExpanded }))}
              >
                {isExpanded ? "Collapse" : `+${replies.length - repliesLimit} more replies`}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={onClose}
    >
      <div
        className="h-screen w-full overflow-y-auto border-purple-500/30 bg-zinc-950 shadow-[0_0_60px_rgba(132,0,255,0.20)] sm:h-auto sm:max-h-[90vh] sm:max-w-3xl sm:border"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Hero header */}
        <div className="relative overflow-hidden border-b border-zinc-800/90 bg-gradient-to-r from-purple-950/20 to-transparent px-5 py-4">
          <div className="pointer-events-none absolute right-0 top-0 h-full w-48 bg-[linear-gradient(135deg,transparent_0%,rgba(139,92,246,0.07)_42%,transparent_43%)]" />
          <div className="pointer-events-none absolute bottom-0 left-0 h-px w-full bg-gradient-to-r from-purple-500/40 via-zinc-700/30 to-transparent" />
          <div className="relative flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              {loading ? (
                <div className="h-14 w-14 shrink-0 animate-pulse bg-zinc-800" />
              ) : (
                <Avatar
                  user={profile?.nickname ?? profile?.user_id ?? "?"}
                  src={profile?.avatar_url}
                  className="h-14 w-14 shrink-0"
                />
              )}
              <div className="min-w-0">
                <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                  {isMine ? "My Profile" : "Public Profile"}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {loading ? (
                    <div className="h-6 w-32 animate-pulse bg-zinc-800" />
                  ) : (
                    <h2
                      className={cn("text-xl font-black uppercase tracking-[0.12em] text-zinc-100", profile?.nickname_style?.animated && "animate-pulse")}
                      style={getInlineColorStyle(profile?.nickname_style)}
                    >
                      {profile?.nickname ?? profile?.user_id ?? "—"}
                    </h2>
                  )}
                  {isAdminProfile && <AdminBadge className="px-2 py-0.5 text-[9px]" />}
                  {profile?.rank && (
                    <span className={cn("border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.1em]", getRankClass(formatRankLabel(profile.rank)))}>
                      {formatRankLabel(profile.rank)}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {profile?.selected_title?.label && (
                    <span
                      className={cn("border border-purple-500/40 bg-purple-950/30 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.1em]", profile.selected_title.animated && "animate-pulse")}
                      style={profileTitleStyle(profile)}
                    >
                      {profile.selected_title.label}
                    </span>
                  )}
                  {profile?.selected_badges?.map((badge) => (
                    <span
                      className="border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.1em] text-zinc-300"
                      key={badge.id ?? badge.label}
                      style={badge.color ? { color: badge.color, borderColor: badge.color } : undefined}
                    >
                      {badge.label ?? badge.id}
                    </span>
                  ))}
                  {profile && (
                    <span className="text-[9px] uppercase tracking-[0.1em] text-zinc-600">
                      {[profile.country_code, `${profile.account_age_days ?? 0}d`].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center border border-zinc-800 bg-black/80 text-zinc-400 transition-colors hover:border-purple-400 hover:text-white"
              onClick={onClose}
              type="button"
              aria-label="Close profile"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="space-y-3 p-5">
          {loading ? (
            <div className="space-y-3">
              <div className="h-28 animate-pulse border border-zinc-900 bg-black/60" />
              <div className="grid grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse border border-zinc-900 bg-black/60" />
                ))}
              </div>
            </div>
          ) : profile ? (
            <>
              {/* Rating card */}
              <div className="border border-zinc-800/80 bg-black/50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[9px] uppercase tracking-[0.14em] text-zinc-600">Current Rating</div>
                    <div className="mt-1 text-5xl font-black tabular-nums leading-none text-zinc-100">
                      {profile.rating ?? 0}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] uppercase tracking-[0.12em] text-zinc-600">Peak</div>
                    <div className="mt-0.5 text-xl font-black tabular-nums text-zinc-400">
                      {profile.peak_rating ?? 0}
                    </div>
                    {profile.last_match_at && (
                      <div className="mt-2 text-[9px] uppercase tracking-[0.1em] text-zinc-700">
                        Last match {formatDateShort(profile.last_match_at)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-4">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[9px] uppercase tracking-[0.12em] text-zinc-600">→ {profile.next_rank ?? "Next rank"}</span>
                    <span className="text-[9px] font-black tabular-nums text-purple-300">{progress}%</span>
                  </div>
                  <div className="h-3 overflow-hidden bg-zinc-900/80">
                    <div
                      className="h-full bg-gradient-to-r from-purple-600 to-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.6)] transition-[width] duration-500 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Combat stats */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([
                  ["Wins", profile.wins ?? 0],
                  ["Losses", profile.losses ?? 0],
                  ["Win Rate", `${Math.round(profile.win_rate ?? 0)}%`],
                  ["Streak", profile.streak ?? 0],
                ] as [string, string | number][]).map(([label, value]) => (
                  <div className="border border-zinc-800/80 bg-black/50 p-3" key={label}>
                    <div className="text-[9px] uppercase tracking-[0.12em] text-zinc-600">{label}</div>
                    <div className="mt-1.5 text-xl font-black tabular-nums text-zinc-100">{value}</div>
                  </div>
                ))}
              </div>

              {/* Score stats */}
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {([
                  ["Avg", profile.average_score],
                  ["Best", profile.best_score],
                  ["Recent", profile.recent_score],
                  ["Lab Best", profile.test_lab_best],
                  ["Lab Avg", profile.test_lab_average],
                ] as [string, number | undefined][]).map(([label, value]) => (
                  <div className="border border-zinc-900/80 bg-black/40 p-2.5" key={label}>
                    <div className="text-[8px] uppercase tracking-[0.12em] text-zinc-700">{label}</div>
                    <div className="mt-1 text-base font-black tabular-nums text-zinc-400">
                      {formatProfileScore(typeof value === "number" ? value : null)}
                    </div>
                  </div>
                ))}
              </div>

              {/* Bio / Edit */}
              {isMine ? (
                <div className="space-y-2 border border-zinc-800/80 bg-black/50 p-4">
                  <div className="text-[9px] font-black uppercase tracking-[0.14em] text-zinc-500">Edit Profile</div>

                  {/* Avatar upload */}
                  <div className="border border-zinc-800 bg-black/60">
                    <label className="flex cursor-pointer items-center gap-3 p-3 transition-colors hover:border-purple-400/50">
                      <div className="relative">
                        <Avatar
                          user={profile.nickname ?? profile.user_id}
                          src={avatarFile ? URL.createObjectURL(avatarFile) : profile.avatar_url}
                          className="h-12 w-12 shrink-0"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity hover:opacity-100">
                          <Camera className="h-4 w-4 text-white" />
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[9px] font-black uppercase tracking-[0.12em] text-zinc-400">Avatar</div>
                        <div className="mt-0.5 truncate text-[9px] text-zinc-600">
                          {avatarFile ? avatarFile.name : "Click to upload PNG, JPG or WEBP · max 5 MB"}
                        </div>
                      </div>
                      <input
                        className="sr-only"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          if (file && file.size > 5 * 1024 * 1024) {
                            setError("Avatar must be 5 MB or smaller");
                            e.target.value = "";
                            setAvatarFile(null);
                            return;
                          }
                          setError(null);
                          setAvatarFile(file);
                        }}
                      />
                    </label>
                  </div>

                  <input
                    className="h-10 w-full border border-zinc-800 bg-black/80 px-3 text-xs uppercase text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-purple-400"
                    placeholder="Country code (e.g. US)"
                    maxLength={2}
                    value={editCountry}
                    onChange={(e) => setEditCountry(e.target.value.toUpperCase())}
                  />
                  <textarea
                    className="w-full resize-none border border-zinc-800 bg-black/80 p-3 text-xs leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-purple-400"
                    placeholder="Bio — tell the community about yourself"
                    rows={4}
                    maxLength={280}
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value)}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[9px] tabular-nums text-zinc-700">{editBio.length} / 280</span>
                    <button
                      className="h-9 border border-purple-500/50 bg-purple-950/35 px-5 text-[10px] font-black uppercase tracking-[0.14em] text-purple-100 transition-colors hover:border-purple-300 hover:bg-purple-900/40 disabled:opacity-40"
                      type="button"
                      disabled={saving}
                      onClick={saveProfile}
                    >
                      {saving ? "Saving…" : "Save Profile"}
                    </button>
                  </div>
                </div>
              ) : (
                profile.bio ? (
                  <div className="border border-zinc-800/80 bg-black/50 p-4">
                    <div className="mb-2 text-[9px] uppercase tracking-[0.14em] text-zinc-600">Bio</div>
                    <p className="text-sm leading-6 text-zinc-300">{profile.bio}</p>
                  </div>
                ) : null
              )}

              {/* Comments */}
              <div className="border border-zinc-800/80 bg-black/50 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5 text-zinc-600" />
                    <span className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400">
                      Comments
                    </span>
                    {comments.length > 0 && (
                      <span className="border border-zinc-800 bg-black/50 px-1.5 py-0.5 text-[9px] font-black tabular-nums text-zinc-500">
                        {comments.length}
                      </span>
                    )}
                  </div>
                </div>

                {/* Comment input */}
                <form className="mb-4 flex items-center gap-2" onSubmit={submitComment}>
                  <Avatar
                    user={myUserID ?? "?"}
                    className="h-8 w-8 shrink-0"
                  />
                  <input
                    className="h-9 min-w-0 flex-1 border border-zinc-800 bg-black/80 px-3 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-purple-400"
                    placeholder="Leave a comment…"
                    maxLength={1000}
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                  />
                  <button
                    className="h-9 shrink-0 border border-purple-500/50 bg-purple-950/35 px-3 text-[9px] font-black uppercase tracking-[0.12em] text-purple-100 transition-colors hover:border-purple-300 disabled:opacity-40"
                    type="submit"
                    disabled={saving || !commentDraft.trim()}
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </form>

                {/* Comment list */}
                <div className="space-y-3">
                  {rootComments.map((comment) => renderComment(comment))}
                  {!commentsLoading && comments.length === 0 && (
                    <div className="flex flex-col items-center gap-2 py-8 text-center">
                      <MessageSquare className="h-6 w-6 text-zinc-700" />
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
                        No comments yet
                      </span>
                      <span className="text-[9px] text-zinc-700">Be the first to leave one</span>
                    </div>
                  )}
                  {commentsLoading && (
                    <div className="space-y-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="flex gap-2.5 border border-zinc-900 bg-black/50 p-3">
                          <div className="h-7 w-7 shrink-0 animate-pulse bg-zinc-800" />
                          <div className="flex-1 space-y-2">
                            <div className="h-3 w-24 animate-pulse bg-zinc-800" />
                            <div className="h-3 w-full animate-pulse bg-zinc-800" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {nextCursor && (
                  <button
                    className="mt-3 h-9 w-full border border-zinc-800 bg-black/60 text-[9px] font-black uppercase tracking-[0.14em] text-zinc-500 transition-colors hover:border-purple-400/50 hover:text-zinc-300 disabled:opacity-40"
                    type="button"
                    disabled={commentsLoading}
                    onClick={() => loadComments(nextCursor)}
                  >
                    Load More
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="border border-red-500/40 bg-red-950/30 p-4 text-xs text-red-200">
              Profile not found.
            </div>
          )}

          {error && (
            <div className="border border-red-500/40 bg-red-950/30 px-3 py-2 text-[9px] font-black uppercase tracking-[0.12em] text-red-300">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

