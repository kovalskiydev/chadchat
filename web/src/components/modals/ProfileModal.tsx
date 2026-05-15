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

  const renderComment = (comment: ProfileComment, depth = 0): React.ReactNode => {
    const replies = repliesByParent[comment.id] ?? [];
    const isReplying = replyingTo === comment.id;
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
      <div
        className={cn(
          "border bg-black/60 p-3",
          depth === 0 ? "border-zinc-900" : "border-zinc-800/80",
        )}
        key={comment.id}
      >
        <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.12em] text-zinc-500">
          <span className={cn("font-semibold", comment.is_deleted ? "text-zinc-600" : "text-zinc-300")}>
            {comment.author_nickname}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <span>{formatDateShort(comment.created_at)}</span>
            {canDelete && (
              <button
                className="inline-flex h-6 w-6 items-center justify-center border border-red-500/35 bg-red-950/20 text-red-300 transition-colors hover:border-red-400 hover:bg-red-950/40 hover:text-red-100 disabled:cursor-wait disabled:opacity-50"
                type="button"
                title="Delete comment"
                aria-label="Delete comment"
                disabled={isDeleting}
                onClick={() => deleteComment(comment.id)}
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        {comment.parent_comment_id && (
          <div className="mt-2 inline-flex border border-purple-500/30 bg-purple-950/20 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-purple-200">
            Reply in thread
          </div>
        )}
        {comment.is_deleted ? (
          <p className="mt-2 text-xs italic leading-5 text-zinc-600">Deleted comment</p>
        ) : (
          <>
            <p className="mt-2 break-words text-xs leading-5 text-zinc-300">{comment.text}</p>
            <div className="mt-2 flex items-center gap-3">
              <button
                className={cn(
                  "inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors",
                  comment.my_vote === 1
                    ? "text-emerald-300"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
                type="button"
                disabled={!canVote}
                onClick={() => voteComment(comment.id, comment.my_vote === 1 ? 0 : 1)}
              >
                <ThumbsUp className="h-3 w-3" aria-hidden="true" />
                <span>{comment.like_count}</span>
              </button>
              <button
                className={cn(
                  "inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors",
                  comment.my_vote === -1
                    ? "text-red-300"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
                type="button"
                disabled={!canVote}
                onClick={() => voteComment(comment.id, comment.my_vote === -1 ? 0 : -1)}
              >
                <ThumbsDown className="h-3 w-3" aria-hidden="true" />
                <span>{comment.dislike_count}</span>
              </button>
              <button
                className="text-[10px] font-semibold uppercase tracking-[0.12em] text-purple-300 transition-colors hover:text-purple-100"
                type="button"
                onClick={() =>
                  setReplyingTo((current) =>
                    current === comment.id ? null : comment.id,
                  )
                }
              >
                Reply
              </button>
            </div>
          </>
        )}
        {isReplying && (
          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
            <input
              className="h-9 border border-zinc-800 bg-black/80 px-3 text-xs text-zinc-100 outline-none focus:border-purple-400"
              placeholder={`Reply to ${comment.author_nickname}`}
              maxLength={1000}
              value={replyDrafts[comment.id] ?? ""}
              onChange={(event) =>
                setReplyDrafts((current) => ({
                  ...current,
                  [comment.id]: event.target.value,
                }))
              }
            />
            <button
              className="h-9 border border-purple-500/50 bg-purple-950/35 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-purple-100 disabled:opacity-40"
              type="button"
              disabled={saving || !(replyDrafts[comment.id] ?? "").trim()}
              onClick={() => submitReply(comment.id)}
            >
              Send
            </button>
          </div>
        )}
        {Boolean(visibleReplies.length) && (
          <div className="mt-3 space-y-2 border-l border-purple-500/25 pl-3">
            {visibleReplies.map((reply) => renderComment(reply, depth + 1))}
            {hasMoreReplies && (
              <button
                className="text-[10px] font-semibold uppercase tracking-[0.12em] text-purple-300 transition-colors hover:text-purple-100"
                type="button"
                onClick={() =>
                  setExpandedReplies((current) => ({
                    ...current,
                    [comment.id]: !isExpanded,
                  }))
                }
              >
                {isExpanded
                  ? "Collapse replies"
                  : `Show ${replies.length - repliesLimit} more replies`}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/72 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={onClose}
    >
      <div
        className="h-screen w-full overflow-y-auto border-x-0 border-purple-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(132,0,255,0.22)] sm:h-auto sm:max-h-[90vh] sm:max-w-3xl sm:rounded-none sm:border"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
              {isMine ? "My Profile" : "Public Profile"}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-black uppercase tracking-[0.14em] text-zinc-100">
                {profile?.nickname ?? "Loading..."}
              </h2>
              {isAdminProfile && <AdminBadge className="px-2 py-1 text-[9px]" />}
            </div>
          </div>
          <button
            className="inline-flex h-10 w-10 items-center justify-center border border-zinc-800 bg-black/80 text-zinc-400 transition-colors hover:border-purple-400 hover:text-white"
            onClick={onClose}
            type="button"
            aria-label="Close profile"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {loading ? (
            <div className="h-64 animate-pulse border border-zinc-900 bg-black/60" />
          ) : profile ? (
            <>
              <div className="grid gap-4 md:grid-cols-[220px_1fr]">
                <div className="border border-zinc-900 bg-black/60 p-4">
                  {profile.avatar_url ? (
                    <img
                      alt=""
                      className="h-28 w-28 border border-zinc-800 object-cover"
                      src={profile.avatar_url}
                    />
                  ) : (
                    <Avatar user={profile.nickname ?? profile.user_id} className="h-28 w-28" />
                  )}
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {profile.selected_title?.label && (
                      <span
                        className={cn(
                          "border border-purple-500/45 bg-purple-950/35 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em]",
                          profile.selected_title.animated && "animate-pulse",
                        )}
                        style={profileTitleStyle(profile)}
                      >
                        {profile.selected_title.label}
                      </span>
                    )}
                    {profile.selected_badges?.map((badge) => (
                      <span
                        className="border border-zinc-800 bg-zinc-950 px-2 py-1 text-[9px] font-black uppercase tracking-[0.1em]"
                        key={badge.id ?? badge.label}
                        style={badge.color ? { color: badge.color, borderColor: badge.color } : undefined}
                      >
                        {badge.label ?? badge.id}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <div
                      className={cn(
                        "min-w-0 truncate text-xl font-black uppercase tracking-[0.12em]",
                        profile.nickname_style?.animated && "animate-pulse",
                      )}
                      style={getInlineColorStyle(profile.nickname_style)}
                    >
                      {profile.nickname ?? profile.user_id}
                    </div>
                    {isAdminProfile && <AdminBadge className="px-2.5 py-1 text-[10px]" />}
                  </div>
                  <div className="mt-2 text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                    {profile.country_code ?? "--"} / {isAdminProfile ? "admin" : (profile.type ?? "user")} / {profile.account_age_days ?? 0}d
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="border border-zinc-900 bg-black/60 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                          Rating
                        </div>
                        <div className="mt-1 text-3xl font-black tabular-nums text-zinc-100">
                          {profile.rating ?? 0}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={cn("inline-flex border px-3 py-1 text-xs font-black uppercase tracking-[0.12em]", getRankClass(formatRankLabel(profile.rank)))}>
                          {formatRankLabel(profile.rank)}
                        </div>
                        <div className="mt-2 text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                          peak {profile.peak_rating ?? 0}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 h-2 overflow-hidden border border-zinc-800 bg-black">
                      <div className="h-full bg-purple-400 transition-[width] duration-300" style={{ width: `${progress}%` }} />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-4">
                    {[
                      ["Wins", profile.wins ?? 0],
                      ["Losses", profile.losses ?? 0],
                      ["Win rate", `${Math.round(profile.win_rate ?? 0)}%`],
                      ["Streak", profile.streak ?? 0],
                    ].map(([label, value]) => (
                      <div className="border border-zinc-900 bg-black/60 p-3" key={label}>
                        <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">{label}</div>
                        <div className="mt-2 text-lg font-black tabular-nums text-zinc-100">{value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-5">
                    {[
                      ["Avg", profile.average_score],
                      ["Best", profile.best_score],
                      ["Recent", profile.recent_score],
                      ["Lab Best", profile.test_lab_best],
                      ["Lab Avg", profile.test_lab_average],
                    ].map(([label, value]) => (
                      <div className="border border-zinc-900 bg-black/60 p-3" key={label}>
                        <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">{label}</div>
                        <div className="mt-2 text-lg font-black tabular-nums text-zinc-100">
                          {formatProfileScore(typeof value === "number" ? value : null)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {isMine ? (
                <div className="grid gap-3 border border-zinc-900 bg-black/60 p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
                    Edit Profile
                  </div>
                  <label className="grid gap-2 border border-zinc-800 bg-black/80 p-3 text-xs text-zinc-100 transition-colors hover:border-purple-400">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                      Avatar Image
                    </span>
                    <input
                      className="text-[10px] text-zinc-400 file:mr-3 file:border file:border-zinc-700 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-[10px] file:font-semibold file:uppercase file:tracking-[0.12em] file:text-zinc-200"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        if (file && file.size > 5 * 1024 * 1024) {
                          setError("Avatar must be 5 MB or smaller");
                          event.target.value = "";
                          setAvatarFile(null);
                          return;
                        }
                        setError(null);
                        setAvatarFile(file);
                      }}
                    />
                    <span className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                      {avatarFile ? avatarFile.name : "PNG, JPG, or WEBP up to 5 MB"}
                    </span>
                  </label>
                  <input
                    className="h-10 border border-zinc-800 bg-black/80 px-3 text-xs uppercase text-zinc-100 outline-none focus:border-purple-400"
                    placeholder="Country code"
                    maxLength={2}
                    value={editCountry}
                    onChange={(event) => setEditCountry(event.target.value.toUpperCase())}
                  />
                  <textarea
                    className="min-h-24 resize-none border border-zinc-800 bg-black/80 p-3 text-xs text-zinc-100 outline-none focus:border-purple-400"
                    placeholder="Bio"
                    maxLength={280}
                    value={editBio}
                    onChange={(event) => setEditBio(event.target.value)}
                  />
                  <button
                    className="h-10 border border-purple-500/50 bg-purple-950/35 px-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-purple-100 transition-colors hover:border-purple-300 disabled:opacity-40"
                    type="button"
                    disabled={saving}
                    onClick={saveProfile}
                  >
                    Save Profile
                  </button>
                </div>
              ) : (
                <div className="border border-zinc-900 bg-black/60 p-4">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">Bio</div>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">{profile.bio || "No bio yet."}</p>
                </div>
              )}

              <div className="border border-zinc-900 bg-black/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
                    Comments
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                    last match {formatDateShort(profile.last_match_at)}
                  </div>
                </div>
                <form className="mb-3 grid grid-cols-[1fr_auto] gap-2" onSubmit={submitComment}>
                  <input
                    className="h-10 border border-zinc-800 bg-black/80 px-3 text-xs text-zinc-100 outline-none focus:border-purple-400"
                    placeholder="Leave a comment"
                    maxLength={1000}
                    value={commentDraft}
                    onChange={(event) => setCommentDraft(event.target.value)}
                  />
                  <button
                    className="h-10 border border-purple-500/50 bg-purple-950/35 px-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-purple-100 disabled:opacity-40"
                    type="submit"
                    disabled={saving || !commentDraft.trim()}
                  >
                    Post
                  </button>
                </form>
                <div className="space-y-2">
                  {rootComments.map((comment) => renderComment(comment))}
                  {!comments.length && !commentsLoading && (
                    <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                      No comments yet.
                    </div>
                  )}
                </div>
                {nextCursor && (
                  <button
                    className="mt-3 h-10 w-full border border-zinc-800 bg-black/70 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-300 transition-colors hover:border-purple-400"
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
            <div className="border border-red-500/45 bg-red-950/35 p-4 text-xs text-red-200">
              Profile not found.
            </div>
          )}
          {error && (
            <div className="border border-red-500/45 bg-red-950/35 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-200">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

