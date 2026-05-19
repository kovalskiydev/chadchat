"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowBigUp,
  ArrowBigDown,
  MessageSquare,
  Share2,
  Trash2,
  Send,
  ChevronLeft,
  Plus,
  X,
  TrendingUp,
  Clock,
  Award,
  Flame,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { loadTokens } from "@/lib/auth";
import {
  getCommunityFeed,
  getCommunityPost,
  createCommunityPost,
  voteCommunityPost,
  createCommunityComment,
  voteCommunityComment,
  shareCommunityPost,
  deleteCommunityPost,
  deleteCommunityComment,
  type CommunityPost,
  type CommunityComment,
} from "@/lib/community";
import { getRankClass, formatRankLabel } from "@/lib/utils-app";

const FLAIRS = [
  { key: "mog_court", label: "Mog Court", color: "border-purple-400/50 text-purple-300 bg-purple-950/30" },
  { key: "looksmax_log", label: "Looksmax Log", color: "border-emerald-400/50 text-emerald-300 bg-emerald-950/30" },
  { key: "rate_me", label: "Rate Me", color: "border-sky-400/50 text-sky-300 bg-sky-950/30" },
  { key: "duel_replay", label: "Duel Replay", color: "border-red-400/50 text-red-300 bg-red-950/30" },
  { key: "theory", label: "Theory", color: "border-amber-400/50 text-amber-300 bg-amber-950/30" },
  { key: "general", label: "General", color: "border-zinc-500/50 text-zinc-300 bg-zinc-900/50" },
];

export function CommunityModal({
  onClose,
  onOpenProfile,
  myUserId,
  myRole,
}: {
  onClose: () => void;
  onOpenProfile: (userID: string) => void;
  myUserId: string | null;
  myRole?: string;
}) {
  const router = useRouter();
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedPost, setSelectedPost] = useState<CommunityPost | null>(null);
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newPostTitle, setNewPostTitle] = useState("");
  const [newPostBody, setNewPostBody] = useState("");
  const [newPostFlair, setNewPostFlair] = useState("general");
  const [sortBy, setSortBy] = useState<"hot" | "new" | "top">("hot");
  const feedRef = useRef<HTMLDivElement>(null);
  const tokens = loadTokens();

  const fetchFeed = useCallback(async (c = "") => {
    setLoading(true);
    try {
      const res = await getCommunityFeed(c, 20);
      if (c) {
        setPosts((prev) => [...prev, ...res.posts]);
      } else {
        setPosts(res.posts);
      }
      setNextCursor(res.next_cursor);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFeed();
  }, [fetchFeed]);

  const openPost = useCallback(async (post: CommunityPost) => {
    setSelectedPost(post);
    setComments([]);
    try {
      const res = await getCommunityPost(post.id);
      setComments(res.comments);
    } catch {
      // ignore
    }
  }, []);

  const handleVotePost = useCallback(async (postID: string, currentVote: number, targetVote: number) => {
    const vote = currentVote === targetVote ? 0 : targetVote;
    try {
      await voteCommunityPost(postID, vote as 1 | -1 | 0);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postID
            ? {
                ...p,
                my_vote: vote,
                like_count: p.like_count + (vote === 1 ? (currentVote === 1 ? -1 : 1) : currentVote === 1 ? -1 : 0) - (currentVote === -1 && vote === 1 ? -1 : 0),
                dislike_count: p.dislike_count + (vote === -1 ? (currentVote === -1 ? -1 : 1) : currentVote === -1 ? -1 : 0) - (currentVote === 1 && vote === -1 ? -1 : 0),
              }
            : p,
        ),
      );
      if (selectedPost?.id === postID) {
        setSelectedPost((p) =>
          p
            ? {
                ...p,
                my_vote: vote,
                like_count: p.like_count + (vote === 1 ? (currentVote === 1 ? -1 : 1) : currentVote === 1 ? -1 : 0) - (currentVote === -1 && vote === 1 ? -1 : 0),
                dislike_count: p.dislike_count + (vote === -1 ? (currentVote === -1 ? -1 : 1) : currentVote === -1 ? -1 : 0) - (currentVote === 1 && vote === -1 ? -1 : 0),
              }
            : null,
        );
      }
    } catch {
      // ignore
    }
  }, [selectedPost]);

  const handleVoteComment = useCallback(async (commentID: string, currentVote: number, targetVote: number) => {
    const vote = currentVote === targetVote ? 0 : targetVote;
    try {
      await voteCommunityComment(commentID, vote as 1 | -1 | 0);
      setComments((prev) => updateCommentVote(prev, commentID, vote, currentVote));
    } catch {
      // ignore
    }
  }, []);

  const handleCreatePost = useCallback(async () => {
    if (!newPostTitle.trim() || !newPostBody.trim()) return;
    try {
      const post = await createCommunityPost({
        title: newPostTitle.trim(),
        body: newPostBody.trim(),
        flair: newPostFlair,
      });
      setPosts((prev) => [post, ...prev]);
      setShowCreate(false);
      setNewPostTitle("");
      setNewPostBody("");
      setNewPostFlair("general");
    } catch {
      // ignore
    }
  }, [newPostTitle, newPostBody, newPostFlair]);

  const handleCreateComment = useCallback(async () => {
    if (!selectedPost || !commentText.trim()) return;
    try {
      const comment = await createCommunityComment(selectedPost.id, {
        text: commentText.trim(),
        parent_comment_id: replyTo ?? undefined,
      });
      setComments((prev) => [...prev, comment]);
      setCommentText("");
      setReplyTo(null);
      setPosts((prev) =>
        prev.map((p) => (p.id === selectedPost.id ? { ...p, comment_count: p.comment_count + 1 } : p)),
      );
    } catch {
      // ignore
    }
  }, [selectedPost, commentText, replyTo]);

  const handleShare = useCallback(async (postID: string) => {
    try {
      const res = await shareCommunityPost(postID);
      setPosts((prev) => prev.map((p) => (p.id === postID ? { ...p, share_count: res.share_count } : p)));
      if (selectedPost?.id === postID) {
        setSelectedPost((p) => (p ? { ...p, share_count: res.share_count } : null));
      }
      void navigator.clipboard.writeText(`${window.location.origin}/community?post=${postID}`);
    } catch {
      // ignore
    }
  }, [selectedPost]);

  const handleDeletePost = useCallback(async (postID: string) => {
    try {
      await deleteCommunityPost(postID);
      setPosts((prev) => prev.filter((p) => p.id !== postID));
      if (selectedPost?.id === postID) setSelectedPost(null);
    } catch {
      // ignore
    }
  }, [selectedPost]);

  const handleDeleteComment = useCallback(async (commentID: string) => {
    try {
      await deleteCommunityComment(commentID);
      setComments((prev) => prev.filter((c) => c.id !== commentID));
    } catch {
      // ignore
    }
  }, []);

  const canDelete = useCallback((authorId: string) => {
    if (!myUserId) return false;
    if (authorId === myUserId) return true;
    return myRole?.toLowerCase() === "admin";
  }, [myUserId, myRole]);

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4">
      <div className="flex w-full max-w-2xl flex-col border border-zinc-800 bg-zinc-950 shadow-[0_0_60px_rgba(132,0,255,0.12)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.14em] text-zinc-100">Community</h2>
            <p className="mt-0.5 text-[9px] uppercase tracking-[0.1em] text-zinc-600">Mog Court · Looksmax Logs · Rate Me · Theory</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex h-8 items-center gap-1.5 border border-purple-500/50 bg-purple-950/30 px-2.5 text-[9px] font-black uppercase tracking-[0.12em] text-purple-100 transition-colors hover:border-purple-300 hover:text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              Post
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center border border-zinc-700 bg-black/70 text-zinc-400 transition-colors hover:border-purple-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Sort tabs */}
        {!selectedPost && (
          <div className="flex items-center gap-1 border-b border-zinc-800 px-4 py-2">
            {([
              { key: "hot", label: "Hot", icon: <Flame className="h-3 w-3" /> },
              { key: "new", label: "New", icon: <Clock className="h-3 w-3" /> },
              { key: "top", label: "Top", icon: <TrendingUp className="h-3 w-3" /> },
            ] as const).map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSortBy(s.key)}
                className={cn(
                  "inline-flex items-center gap-1 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.1em] transition-colors",
                  sortBy === s.key ? "border border-zinc-700 bg-black text-zinc-100" : "text-zinc-600 hover:text-zinc-300",
                )}
              >
                {s.icon}
                {s.label}
              </button>
            ))}
          </div>
        )}

        {/* Create post modal */}
        {showCreate && (
          <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center">
            <div className="w-full max-w-lg border border-zinc-800 bg-zinc-950 p-4 shadow-[0_0_40px_rgba(132,0,255,0.15)]">
              <div className="flex items-center justify-between">
                <span className="text-sm font-black uppercase tracking-[0.12em] text-zinc-100">Create Post</span>
                <button type="button" onClick={() => setShowCreate(false)} className="text-zinc-500 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 space-y-3">
                <input
                  type="text"
                  value={newPostTitle}
                  onChange={(e) => setNewPostTitle(e.target.value)}
                  placeholder="Title"
                  className="w-full border border-zinc-800 bg-black px-3 py-2 text-sm font-semibold text-zinc-200 placeholder:text-zinc-700 focus:border-purple-400 focus:outline-none"
                />
                <textarea
                  value={newPostBody}
                  onChange={(e) => setNewPostBody(e.target.value)}
                  placeholder="What's on your mind?"
                  rows={5}
                  className="w-full resize-none border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-700 focus:border-purple-400 focus:outline-none"
                />
                <div className="flex flex-wrap gap-1.5">
                  {FLAIRS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setNewPostFlair(f.key)}
                      className={cn(
                        "border px-2 py-1 text-[9px] font-black uppercase tracking-[0.08em] transition-colors",
                        newPostFlair === f.key ? f.color : "border-zinc-800 text-zinc-600",
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleCreatePost}
                  disabled={!newPostTitle.trim() || !newPostBody.trim()}
                  className="inline-flex h-9 w-full items-center justify-center border border-purple-500/50 bg-purple-950/30 text-[10px] font-black uppercase tracking-[0.12em] text-purple-100 transition-colors hover:border-purple-300 hover:text-white disabled:opacity-30"
                >
                  <Send className="mr-1.5 h-3 w-3" />
                  Post
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div ref={feedRef} className="flex-1 overflow-y-auto p-3 sm:p-4">
          {selectedPost ? (
            <PostDetail
              post={selectedPost}
              comments={comments}
              commentText={commentText}
              replyTo={replyTo}
              onCommentText={setCommentText}
              onReplyTo={setReplyTo}
              onBack={() => setSelectedPost(null)}
              onVotePost={handleVotePost}
              onVoteComment={handleVoteComment}
              onCreateComment={handleCreateComment}
              onShare={handleShare}
              onDeletePost={handleDeletePost}
              onDeleteComment={handleDeleteComment}
              onOpenProfile={onOpenProfile}
              canDelete={canDelete}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onOpen={() => openPost(post)}
                  onVote={(vote) => handleVotePost(post.id, post.my_vote, vote)}
                  onShare={() => handleShare(post.id)}
                  onDelete={() => handleDeletePost(post.id)}
                  onOpenProfile={onOpenProfile}
                  canDelete={canDelete}
                />
              ))}
              {loading && (
                <div className="flex h-20 items-center justify-center">
                  <div className="h-6 w-6 animate-spin border-2 border-zinc-800 border-t-purple-400" />
                </div>
              )}
              {nextCursor && !loading && (
                <button
                  type="button"
                  onClick={() => void fetchFeed(nextCursor)}
                  className="inline-flex h-10 items-center justify-center border border-zinc-800 bg-black text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500 transition-colors hover:border-purple-400 hover:text-zinc-200"
                >
                  Load More
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PostCard({
  post,
  onOpen,
  onVote,
  onShare,
  onDelete,
  onOpenProfile,
  canDelete,
}: {
  post: CommunityPost;
  onOpen: () => void;
  onVote: (vote: 1 | -1) => void;
  onShare: () => void;
  onDelete: () => void;
  onOpenProfile: (id: string) => void;
  canDelete: (authorId: string) => boolean;
}) {
  const flair = FLAIRS.find((f) => f.key === post.flair) ?? FLAIRS[5];
  const score = post.like_count - post.dislike_count;

  return (
    <div className={cn("border bg-black/60", post.is_pinned ? "border-amber-500/30" : "border-zinc-800")}>
      {post.is_pinned && (
        <div className="flex items-center gap-1.5 border-b border-amber-500/20 bg-amber-950/20 px-3 py-1">
          <Award className="h-3 w-3 text-amber-400" />
          <span className="text-[8px] font-black uppercase tracking-[0.12em] text-amber-300">Pinned</span>
        </div>
      )}
      <div className="flex">
        <div className="flex w-10 flex-col items-center border-r border-zinc-800 py-2">
          <button type="button" onClick={() => onVote(1)} className={cn("transition-colors", post.my_vote === 1 ? "text-purple-300" : "text-zinc-600 hover:text-zinc-300")}>
            <ArrowBigUp className="h-6 w-6" />
          </button>
          <span className={cn("text-xs font-black tabular-nums", score > 0 ? "text-purple-300" : score < 0 ? "text-red-300" : "text-zinc-500")}>{score}</span>
          <button type="button" onClick={() => onVote(-1)} className={cn("transition-colors", post.my_vote === -1 ? "text-red-300" : "text-zinc-600 hover:text-zinc-300")}>
            <ArrowBigDown className="h-6 w-6" />
          </button>
        </div>
        <div className="min-w-0 flex-1 p-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenProfile(post.author_user_id)}
              className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
            >
              {post.author_avatar_url ? (
                <img src={post.author_avatar_url} alt="" className="h-5 w-5 border border-zinc-700 object-cover" />
              ) : (
                <div className="flex h-5 w-5 items-center justify-center border border-zinc-700 bg-zinc-900">
                  <User className="h-3 w-3 text-zinc-600" />
                </div>
              )}
              <span className="text-[10px] font-black uppercase tracking-[0.08em] text-zinc-300">{post.author_nickname}</span>
            </button>
            {post.author_rank && (
              <span className={cn("inline-flex border px-1 py-0.5 text-[7px] font-black uppercase tracking-[0.06em]", getRankClass(formatRankLabel(post.author_rank)))}>
                {formatRankLabel(post.author_rank)}
              </span>
            )}
            <span className="text-[8px] text-zinc-700">{new Date(post.created_at).toLocaleDateString()}</span>
            {flair && (
              <span className={cn("ml-auto inline-flex border px-1.5 py-0.5 text-[7px] font-black uppercase tracking-[0.06em]", flair.color)}>
                {flair.label}
              </span>
            )}
          </div>
          <button type="button" onClick={onOpen} className="mt-2 w-full text-left">
            <h3 className="text-sm font-black uppercase tracking-[0.08em] text-zinc-100">{post.title}</h3>
            <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-zinc-400">{post.body}</p>
          </button>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" onClick={onOpen} className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-600 transition-colors hover:text-zinc-300">
              <MessageSquare className="h-3 w-3" /> {post.comment_count}
            </button>
            <button type="button" onClick={onShare} className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-600 transition-colors hover:text-zinc-300">
              <Share2 className="h-3 w-3" /> {post.share_count}
            </button>
            {canDelete(post.author_user_id) && (
              <button type="button" onClick={onDelete} className="ml-auto text-zinc-700 transition-colors hover:text-red-400">
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PostDetail({
  post,
  comments,
  commentText,
  replyTo,
  onCommentText,
  onReplyTo,
  onBack,
  onVotePost,
  onVoteComment,
  onCreateComment,
  onShare,
  onDeletePost,
  onDeleteComment,
  onOpenProfile,
  canDelete,
}: {
  post: CommunityPost;
  comments: CommunityComment[];
  commentText: string;
  replyTo: string | null;
  onCommentText: (v: string) => void;
  onReplyTo: (v: string | null) => void;
  onBack: () => void;
  onVotePost: (id: string, current: number, target: number) => void;
  onVoteComment: (id: string, current: number, target: number) => void;
  onCreateComment: () => void;
  onShare: (id: string) => void;
  onDeletePost: (id: string) => void;
  onDeleteComment: (id: string) => void;
  onOpenProfile: (id: string) => void;
  canDelete: (authorId: string) => boolean;
}) {
  const flair = FLAIRS.find((f) => f.key === post.flair) ?? FLAIRS[5];
  const score = post.like_count - post.dislike_count;
  const rootComments = comments.filter((c) => !c.parent_comment_id);
  const repliesByParent = comments.reduce<Record<string, CommunityComment[]>>((acc, c) => {
    if (c.parent_comment_id) {
      acc[c.parent_comment_id] = [...(acc[c.parent_comment_id] ?? []), c];
    }
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 transition-colors hover:text-zinc-300">
        <ChevronLeft className="h-3 w-3" /> Back to feed
      </button>

      <div className="border border-zinc-800 bg-black/60">
        <div className="flex">
          <div className="flex w-10 flex-col items-center border-r border-zinc-800 py-2">
            <button type="button" onClick={() => onVotePost(post.id, post.my_vote, 1)} className={cn("transition-colors", post.my_vote === 1 ? "text-purple-300" : "text-zinc-600 hover:text-zinc-300")}>
              <ArrowBigUp className="h-6 w-6" />
            </button>
            <span className={cn("text-xs font-black tabular-nums", score > 0 ? "text-purple-300" : score < 0 ? "text-red-300" : "text-zinc-500")}>{score}</span>
            <button type="button" onClick={() => onVotePost(post.id, post.my_vote, -1)} className={cn("transition-colors", post.my_vote === -1 ? "text-red-300" : "text-zinc-600 hover:text-zinc-300")}>
              <ArrowBigDown className="h-6 w-6" />
            </button>
          </div>
          <div className="min-w-0 flex-1 p-4">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => onOpenProfile(post.author_user_id)} className="flex items-center gap-1.5 transition-opacity hover:opacity-70">
                {post.author_avatar_url ? (
                  <img src={post.author_avatar_url} alt="" className="h-5 w-5 border border-zinc-700 object-cover" />
                ) : (
                  <div className="flex h-5 w-5 items-center justify-center border border-zinc-700 bg-zinc-900">
                    <User className="h-3 w-3 text-zinc-600" />
                  </div>
                )}
                <span className="text-[10px] font-black uppercase tracking-[0.08em] text-zinc-300">{post.author_nickname}</span>
              </button>
              {post.author_rank && (
                <span className={cn("inline-flex border px-1 py-0.5 text-[7px] font-black uppercase", getRankClass(formatRankLabel(post.author_rank)))}>
                  {formatRankLabel(post.author_rank)}
                </span>
              )}
              <span className="text-[8px] text-zinc-700">{new Date(post.created_at).toLocaleDateString()}</span>
              {flair && (
                <span className={cn("ml-auto inline-flex border px-1.5 py-0.5 text-[7px] font-black uppercase", flair.color)}>{flair.label}</span>
              )}
            </div>
            <h1 className="mt-3 text-lg font-black uppercase tracking-[0.1em] text-zinc-100">{post.title}</h1>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{post.body}</p>
            <div className="mt-4 flex items-center gap-4">
              <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-600">
                <MessageSquare className="h-3 w-3" /> {post.comment_count}
              </span>
              <button type="button" onClick={() => onShare(post.id)} className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-600 transition-colors hover:text-zinc-300">
                <Share2 className="h-3 w-3" /> {post.share_count}
              </button>
              {canDelete(post.author_user_id) && (
                <button type="button" onClick={() => onDeletePost(post.id)} className="ml-auto text-zinc-700 transition-colors hover:text-red-400">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="border border-zinc-800 bg-black/40 p-3">
        {replyTo && (
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-purple-300">Replying to comment</span>
            <button type="button" onClick={() => onReplyTo(null)} className="text-zinc-600 hover:text-white">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={commentText}
            onChange={(e) => onCommentText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onCreateComment()}
            placeholder={replyTo ? "Write a reply..." : "Write a comment..."}
            className="min-w-0 flex-1 border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-700 focus:border-purple-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onCreateComment}
            disabled={!commentText.trim()}
            className="inline-flex h-9 items-center border border-purple-500/50 bg-purple-950/30 px-3 text-[10px] font-black uppercase tracking-[0.1em] text-purple-100 transition-colors hover:border-purple-300 hover:text-white disabled:opacity-30"
          >
            <Send className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {rootComments.map((comment) => (
          <CommentThread
            key={comment.id}
            comment={comment}
            replies={repliesByParent[comment.id] ?? []}
            onVote={onVoteComment}
            onReply={onReplyTo}
            onDelete={onDeleteComment}
            onOpenProfile={onOpenProfile}
            canDelete={canDelete}
          />
        ))}
      </div>
    </div>
  );
}

function CommentThread({
  comment,
  replies,
  onVote,
  onReply,
  onDelete,
  onOpenProfile,
  canDelete,
}: {
  comment: CommunityComment;
  replies: CommunityComment[];
  onVote: (id: string, current: number, target: number) => void;
  onReply: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenProfile: (id: string) => void;
  canDelete: (authorId: string) => boolean;
}) {
  const score = comment.like_count - comment.dislike_count;

  return (
    <div className="border border-zinc-800 bg-black/40">
      <div className="flex">
        <div className="flex w-8 flex-col items-center border-r border-zinc-800 py-1">
          <button type="button" onClick={() => onVote(comment.id, comment.my_vote, 1)} className={cn("transition-colors", comment.my_vote === 1 ? "text-purple-300" : "text-zinc-700 hover:text-zinc-400")}>
            <ArrowBigUp className="h-5 w-5" />
          </button>
          <span className={cn("text-[10px] font-black", score > 0 ? "text-purple-300" : score < 0 ? "text-red-300" : "text-zinc-600")}>{score}</span>
          <button type="button" onClick={() => onVote(comment.id, comment.my_vote, -1)} className={cn("transition-colors", comment.my_vote === -1 ? "text-red-300" : "text-zinc-700 hover:text-zinc-400")}>
            <ArrowBigDown className="h-5 w-5" />
          </button>
        </div>
        <div className="min-w-0 flex-1 p-2.5">
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => onOpenProfile(comment.author_user_id)} className="text-[9px] font-black uppercase tracking-[0.08em] text-zinc-300 transition-opacity hover:opacity-70">
              {comment.author_nickname}
            </button>
            {comment.author_rank && (
              <span className={cn("inline-flex border px-1 py-0 text-[6px] font-black uppercase", getRankClass(formatRankLabel(comment.author_rank)))}>
                {formatRankLabel(comment.author_rank)}
              </span>
            )}
            <span className="text-[7px] text-zinc-700">{new Date(comment.created_at).toLocaleDateString()}</span>
          </div>
          <p className="mt-1 text-xs text-zinc-400">{comment.text}</p>
          <div className="mt-1.5 flex items-center gap-3">
            <button type="button" onClick={() => onReply(comment.id)} className="text-[8px] font-semibold uppercase tracking-[0.1em] text-zinc-600 transition-colors hover:text-zinc-300">
              Reply
            </button>
            {canDelete(comment.author_user_id) && (
              <button type="button" onClick={() => onDelete(comment.id)} className="text-zinc-700 transition-colors hover:text-red-400">
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {replies.length > 0 && (
        <div className="border-t border-zinc-800">
          {replies.map((reply) => (
            <div key={reply.id} className="flex border-b border-zinc-800/50 last:border-b-0">
              <div className="flex w-8 flex-col items-center border-r border-zinc-800 py-1">
                <button type="button" onClick={() => onVote(reply.id, reply.my_vote, 1)} className={cn("transition-colors", reply.my_vote === 1 ? "text-purple-300" : "text-zinc-700 hover:text-zinc-400")}>
                  <ArrowBigUp className="h-5 w-5" />
                </button>
                <span className={cn("text-[10px] font-black", reply.like_count - reply.dislike_count > 0 ? "text-purple-300" : reply.like_count - reply.dislike_count < 0 ? "text-red-300" : "text-zinc-600")}>
                  {reply.like_count - reply.dislike_count}
                </span>
                <button type="button" onClick={() => onVote(reply.id, reply.my_vote, -1)} className={cn("transition-colors", reply.my_vote === -1 ? "text-red-300" : "text-zinc-700 hover:text-zinc-400")}>
                  <ArrowBigDown className="h-5 w-5" />
                </button>
              </div>
              <div className="min-w-0 flex-1 p-2">
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => onOpenProfile(reply.author_user_id)} className="text-[9px] font-black uppercase tracking-[0.08em] text-zinc-300 transition-opacity hover:opacity-70">
                    {reply.author_nickname}
                  </button>
                  {reply.author_rank && (
                    <span className={cn("inline-flex border px-1 py-0 text-[6px] font-black uppercase", getRankClass(formatRankLabel(reply.author_rank)))}>
                      {formatRankLabel(reply.author_rank)}
                    </span>
                  )}
                  <span className="text-[7px] text-zinc-700">{new Date(reply.created_at).toLocaleDateString()}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-400">{reply.text}</p>
                {canDelete(reply.author_user_id) && (
                  <button type="button" onClick={() => onDelete(reply.id)} className="mt-1 text-zinc-700 transition-colors hover:text-red-400">
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function updateCommentVote(comments: CommunityComment[], commentID: string, vote: number, currentVote: number): CommunityComment[] {
  return comments.map((c) => {
    if (c.id === commentID) {
      return {
        ...c,
        my_vote: vote,
        like_count: c.like_count + (vote === 1 ? (currentVote === 1 ? -1 : 1) : currentVote === 1 ? -1 : 0) - (currentVote === -1 && vote === 1 ? -1 : 0),
        dislike_count: c.dislike_count + (vote === -1 ? (currentVote === -1 ? -1 : 1) : currentVote === -1 ? -1 : 0) - (currentVote === 1 && vote === -1 ? -1 : 0),
      };
    }
    return c;
  });
}
