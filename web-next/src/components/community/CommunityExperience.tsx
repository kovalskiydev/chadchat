"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  ArrowBigDown,
  ArrowBigUp,
  Award,
  ChevronLeft,
  Clock,
  Flame,
  MessageSquare,
  Plus,
  Search,
  Send,
  Share2,
  Sparkles,
  Trash2,
  TrendingUp,
  User,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  createCommunityComment,
  createCommunityPost,
  deleteCommunityComment,
  deleteCommunityPost,
  getCommunityFeed,
  getCommunityPost,
  shareCommunityPost,
  voteCommunityComment,
  voteCommunityPost,
  type CommunityComment,
  type CommunityPost,
} from "@/lib/community";
import { formatRankLabel, getRankClass } from "@/lib/utils-app";

type SortKey = "hot" | "new" | "top";
type Variant = "page" | "modal";

type CommunityExperienceProps = {
  variant?: Variant;
  onClose?: () => void;
  onOpenProfile: (userID: string) => void;
  myUserId?: string | null;
  myRole?: string;
};

const FLAIRS = [
  { key: "all", label: "All", accent: "border-zinc-700 bg-zinc-900/80 text-zinc-200" },
  { key: "mog_court", label: "Mog Court", accent: "border-fuchsia-400/50 bg-fuchsia-950/30 text-fuchsia-200" },
  { key: "looksmax_log", label: "Looksmax Log", accent: "border-emerald-400/50 bg-emerald-950/30 text-emerald-200" },
  { key: "rate_me", label: "Rate Me", accent: "border-sky-400/50 bg-sky-950/30 text-sky-200" },
  { key: "duel_replay", label: "Duel Replay", accent: "border-rose-400/50 bg-rose-950/30 text-rose-200" },
  { key: "theory", label: "Theory", accent: "border-amber-400/50 bg-amber-950/30 text-amber-200" },
  { key: "general", label: "General", accent: "border-zinc-600/70 bg-black text-zinc-300" },
];

const SORTS = [
  { key: "hot", label: "Hot", icon: Flame },
  { key: "new", label: "New", icon: Clock },
  { key: "top", label: "Top", icon: TrendingUp },
] as const;

const panelClass = "border border-zinc-800/90 bg-zinc-950/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]";
const focusClass = "focus-visible:border-sky-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-300/40";
const smoothClass = "transition-[border-color,background-color,color,box-shadow,transform,opacity] duration-200 ease-out";

const MOCK_POSTS: CommunityPost[] = [
  {
    id: "mock-post-1",
    author_user_id: "mock-user-1",
    author_nickname: "MIRRORSTACK",
    author_rank: "diamond",
    author_role: "creator",
    title: "Weekly Mog Court: clean profile angle or too staged?",
    body:
      "Testing a stricter format for rate posts: one front photo, one candid, one profile. Drop notes on lighting, jaw visibility, and what makes the result feel real.",
    flair: "mog_court",
    like_count: 184,
    dislike_count: 12,
    comment_count: 18,
    share_count: 9,
    my_vote: 1,
    is_pinned: true,
    is_deleted: false,
    created_at: new Date(Date.now() - 1000 * 60 * 38).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "mock-post-2",
    author_user_id: "mock-user-2",
    author_nickname: "LIFTEDLOG",
    author_rank: "platinum",
    title: "4 week looksmax log: skin, sleep, neck posture",
    body:
      "Posting the routine that actually moved my ratings: boring sleep consistency, matte SPF, less salt late at night, and daily neck mobility. Small compounding wins.",
    flair: "looksmax_log",
    like_count: 96,
    dislike_count: 5,
    comment_count: 11,
    share_count: 21,
    my_vote: 0,
    is_pinned: false,
    is_deleted: false,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "mock-post-3",
    author_user_id: "mock-user-3",
    author_nickname: "DUEL_ARCHIVE",
    author_rank: "gold",
    title: "Duel replay: why symmetry lost to expression",
    body:
      "Interesting replay: the higher symmetry score lost because the other user had better eye engagement and camera distance. Rating breakdown in comments.",
    flair: "duel_replay",
    like_count: 63,
    dislike_count: 18,
    comment_count: 7,
    share_count: 4,
    my_vote: 0,
    is_pinned: false,
    is_deleted: false,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 9).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "mock-post-4",
    author_user_id: "mock-user-4",
    author_nickname: "ANGLECHECK",
    author_rank: "silver",
    title: "Rate me: is the haircut carrying or hurting?",
    body:
      "Trying a shorter crop after months of middle part. Looking for direct feedback on face framing, not generic compliments.",
    flair: "rate_me",
    like_count: 41,
    dislike_count: 7,
    comment_count: 14,
    share_count: 2,
    my_vote: -1,
    is_pinned: false,
    is_deleted: false,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const MOCK_COMMENTS: Record<string, CommunityComment[]> = {
  "mock-post-1": [
    {
      id: "mock-comment-1",
      post_id: "mock-post-1",
      author_user_id: "mock-user-5",
      author_nickname: "CAMERALINE",
      author_rank: "platinum",
      text: "Pinned format is good. Add distance from camera as a required note because close lens distortion changes the whole rating.",
      like_count: 27,
      dislike_count: 1,
      my_vote: 0,
      is_deleted: false,
      created_at: new Date(Date.now() - 1000 * 60 * 24).toISOString(),
    },
    {
      id: "mock-comment-2",
      post_id: "mock-post-1",
      author_user_id: "mock-user-6",
      author_nickname: "FRAMECHECK",
      parent_comment_id: "mock-comment-1",
      text: "Agree. Same face can swing hard between 24mm and 70mm.",
      like_count: 12,
      dislike_count: 0,
      my_vote: 1,
      is_deleted: false,
      created_at: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
    },
  ],
  "mock-post-2": [
    {
      id: "mock-comment-3",
      post_id: "mock-post-2",
      author_user_id: "mock-user-7",
      author_nickname: "SKINBASE",
      author_rank: "gold",
      text: "The sleep part is underrated. Your under-eye area changed more than the haircut did.",
      like_count: 18,
      dislike_count: 2,
      my_vote: 0,
      is_deleted: false,
      created_at: new Date(Date.now() - 1000 * 60 * 96).toISOString(),
    },
  ],
};

export function CommunityExperience({
  variant = "page",
  onClose,
  onOpenProfile,
  myUserId = null,
  myRole,
}: CommunityExperienceProps) {
  const [posts, setPosts] = useState<CommunityPost[]>(MOCK_POSTS);
  const [nextCursor, setNextCursor] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedPost, setSelectedPost] = useState<CommunityPost | null>(null);
  const [comments, setComments] = useState<CommunityComment[]>(MOCK_COMMENTS[MOCK_POSTS[0].id] ?? []);
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newPostTitle, setNewPostTitle] = useState("");
  const [newPostBody, setNewPostBody] = useState("");
  const [newPostFlair, setNewPostFlair] = useState("general");
  const [sortBy, setSortBy] = useState<SortKey>("hot");
  const [activeFlair, setActiveFlair] = useState("all");
  const [query, setQuery] = useState("");
  const [usingMockData, setUsingMockData] = useState(true);

  const canDelete = useCallback(
    (authorId: string) => {
      if (authorId.startsWith("mock-user")) return true;
      if (!myUserId) return false;
      return authorId === myUserId || myRole?.toLowerCase() === "admin";
    },
    [myRole, myUserId],
  );

  const fetchFeed = useCallback(async (cursor = "") => {
    setLoading(true);
    try {
      const res = await getCommunityFeed(cursor, 20);
      setPosts((prev) => (cursor ? [...prev, ...res.posts] : res.posts));
      setNextCursor(res.next_cursor);
      setUsingMockData(false);
    } catch {
      if (!cursor) {
        setPosts(MOCK_POSTS);
        setNextCursor("");
        setUsingMockData(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => void fetchFeed(), 0);
    return () => window.clearTimeout(id);
  }, [fetchFeed]);

  const visiblePosts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...posts]
      .filter((post) => activeFlair === "all" || post.flair === activeFlair)
      .filter((post) => {
        if (!normalizedQuery) return true;
        return `${post.title} ${post.body} ${post.author_nickname}`.toLowerCase().includes(normalizedQuery);
      })
      .sort((a, b) => {
        if (sortBy === "new") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        if (sortBy === "top") return scorePost(b) - scorePost(a);
        return heatPost(b) - heatPost(a);
      });
  }, [activeFlair, posts, query, sortBy]);

  const stats = useMemo(
    () => ({
      posts: posts.length,
      comments: posts.reduce((sum, post) => sum + post.comment_count, 0),
      shares: posts.reduce((sum, post) => sum + post.share_count, 0),
    }),
    [posts],
  );

  const openPost = useCallback(async (post: CommunityPost) => {
    setSelectedPost(post);
    setCommentText("");
    setReplyTo(null);
    setComments(MOCK_COMMENTS[post.id] ?? []);
    try {
      const res = await getCommunityPost(post.id);
      setSelectedPost(res.post);
      setComments(res.comments);
      setUsingMockData(false);
    } catch {
      setUsingMockData(true);
    }
  }, []);

  const applyPostVote = useCallback((postID: string, currentVote: number, targetVote: number) => {
    const vote = currentVote === targetVote ? 0 : targetVote;
    setPosts((prev) => prev.map((post) => (post.id === postID ? updatePostVote(post, vote, currentVote) : post)));
    setSelectedPost((post) => (post?.id === postID ? updatePostVote(post, vote, currentVote) : post));
    return vote as 1 | -1 | 0;
  }, []);

  const handleVotePost = useCallback(
    async (postID: string, currentVote: number, targetVote: number) => {
      const vote = applyPostVote(postID, currentVote, targetVote);
      if (!postID.startsWith("mock-")) {
        try {
          await voteCommunityPost(postID, vote);
        } catch {
          // Keep the optimistic local interaction while the API is unavailable.
        }
      }
    },
    [applyPostVote],
  );

  const handleVoteComment = useCallback(async (commentID: string, currentVote: number, targetVote: number) => {
    const vote = currentVote === targetVote ? 0 : targetVote;
    setComments((prev) => updateCommentVote(prev, commentID, vote, currentVote));
    if (!commentID.startsWith("mock-")) {
      try {
        await voteCommunityComment(commentID, vote as 1 | -1 | 0);
      } catch {
        // Keep local vote for offline/mock mode.
      }
    }
  }, []);

  const handleCreatePost = useCallback(async () => {
    if (!newPostTitle.trim() || !newPostBody.trim()) return;
    const draft: CommunityPost = {
      id: `mock-post-${Date.now()}`,
      author_user_id: myUserId ?? "mock-user-me",
      author_nickname: myUserId ? "YOU" : "GUEST",
      author_rank: "bronze",
      title: newPostTitle.trim(),
      body: newPostBody.trim(),
      flair: newPostFlair,
      like_count: 1,
      dislike_count: 0,
      comment_count: 0,
      share_count: 0,
      my_vote: 1,
      is_pinned: false,
      is_deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    try {
      const created = await createCommunityPost({
        title: draft.title,
        body: draft.body,
        flair: draft.flair,
      });
      setPosts((prev) => [created, ...prev]);
      setUsingMockData(false);
    } catch {
      setPosts((prev) => [draft, ...prev]);
      setUsingMockData(true);
    }

    setShowCreate(false);
    setNewPostTitle("");
    setNewPostBody("");
    setNewPostFlair("general");
  }, [myUserId, newPostBody, newPostFlair, newPostTitle]);

  const handleCreateComment = useCallback(async () => {
    if (!selectedPost || !commentText.trim()) return;
    const draft: CommunityComment = {
      id: `mock-comment-${Date.now()}`,
      post_id: selectedPost.id,
      author_user_id: myUserId ?? "mock-user-me",
      author_nickname: myUserId ? "YOU" : "GUEST",
      author_rank: "bronze",
      parent_comment_id: replyTo,
      text: commentText.trim(),
      like_count: 1,
      dislike_count: 0,
      my_vote: 1,
      is_deleted: false,
      created_at: new Date().toISOString(),
    };

    try {
      const created = await createCommunityComment(selectedPost.id, {
        text: draft.text,
        parent_comment_id: replyTo ?? undefined,
      });
      setComments((prev) => [...prev, created]);
      setUsingMockData(false);
    } catch {
      setComments((prev) => [...prev, draft]);
      setUsingMockData(true);
    }

    setPosts((prev) =>
      prev.map((post) => (post.id === selectedPost.id ? { ...post, comment_count: post.comment_count + 1 } : post)),
    );
    setSelectedPost((post) => (post ? { ...post, comment_count: post.comment_count + 1 } : post));
    setCommentText("");
    setReplyTo(null);
  }, [commentText, myUserId, replyTo, selectedPost]);

  const handleShare = useCallback(
    async (postID: string) => {
      const nextShareCount = (posts.find((post) => post.id === postID)?.share_count ?? 0) + 1;
      setPosts((prev) => prev.map((post) => (post.id === postID ? { ...post, share_count: nextShareCount } : post)));
      setSelectedPost((post) => (post?.id === postID ? { ...post, share_count: nextShareCount } : post));
      void navigator.clipboard?.writeText(`${window.location.origin}/community?post=${postID}`);

      if (!postID.startsWith("mock-")) {
        try {
          const res = await shareCommunityPost(postID);
          setPosts((prev) => prev.map((post) => (post.id === postID ? { ...post, share_count: res.share_count } : post)));
          setSelectedPost((post) => (post?.id === postID ? { ...post, share_count: res.share_count } : post));
        } catch {
          // Local share state is enough while API is unavailable.
        }
      }
    },
    [posts],
  );

  const handleDeletePost = useCallback(
    async (postID: string) => {
      setPosts((prev) => prev.filter((post) => post.id !== postID));
      if (selectedPost?.id === postID) setSelectedPost(null);
      if (!postID.startsWith("mock-")) {
        try {
          await deleteCommunityPost(postID);
        } catch {
          // The item stays removed locally in mock/offline mode.
        }
      }
    },
    [selectedPost],
  );

  const handleDeleteComment = useCallback(async (commentID: string) => {
    setComments((prev) => prev.filter((comment) => comment.id !== commentID));
    if (!commentID.startsWith("mock-")) {
      try {
        await deleteCommunityComment(commentID);
      } catch {
        // The item stays removed locally in mock/offline mode.
      }
    }
  }, []);

  const shellClass =
    variant === "modal"
      ? "relative flex h-full min-h-0 w-full flex-col overflow-hidden border border-zinc-800 bg-[#050608] shadow-[0_0_70px_rgba(14,165,233,0.11)]"
      : "relative mx-auto min-h-screen w-full max-w-6xl overflow-hidden px-3 py-5 sm:px-5 lg:px-6";

  return (
    <div className={shellClass}>
      <SharpBackdrop />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <Header
          variant={variant}
          stats={stats}
          usingMockData={usingMockData}
          onCreate={() => setShowCreate(true)}
          onClose={onClose}
        />

        <div className={cn("grid min-h-0 flex-1 gap-4", variant === "modal" ? "grid-cols-1 overflow-y-auto p-3 lg:grid-cols-[218px_minmax(0,1fr)]" : "mt-5 grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)]")}>
        <aside className="space-y-3">
          <div className={cn(panelClass, "relative overflow-hidden p-3")}>
            <CornerCuts />
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search posts"
                className={cn("h-9 w-full border border-zinc-800 bg-black/55 pl-8 pr-3 text-xs text-zinc-200 placeholder:text-zinc-700", focusClass, smoothClass)}
              />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-1">
              {SORTS.map((sort) => {
                const Icon = sort.icon;
                return (
                  <button
                    key={sort.key}
                    type="button"
                    onClick={() => setSortBy(sort.key)}
                    className={cn(
                      "inline-flex h-8 items-center justify-center gap-1 border text-[9px] font-black uppercase tracking-[0.1em]",
                      focusClass,
                      smoothClass,
                      sortBy === sort.key
                        ? "border-sky-400/50 bg-sky-950/35 text-sky-100 shadow-[inset_0_0_18px_rgba(14,165,233,0.08)]"
                        : "border-zinc-800 bg-black/35 text-zinc-600 hover:border-zinc-700 hover:bg-zinc-900/70 hover:text-zinc-300",
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {sort.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={cn(panelClass, "relative overflow-hidden p-2")}>
            <SharpDivider />
            {FLAIRS.map((flair) => (
              <button
                key={flair.key}
                type="button"
                onClick={() => setActiveFlair(flair.key)}
                className={cn(
                  "mb-1 flex h-8 w-full items-center justify-between border px-2 text-left text-[10px] font-black uppercase tracking-[0.08em] last:mb-0",
                  focusClass,
                  smoothClass,
                  activeFlair === flair.key ? flair.accent : "border-transparent text-zinc-600 hover:border-zinc-800 hover:bg-black/45 hover:text-zinc-300",
                )}
              >
                <span>{flair.label}</span>
                <span className="text-[9px] text-zinc-500">
                  {flair.key === "all" ? posts.length : posts.filter((post) => post.flair === flair.key).length}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="min-w-0">
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
            <div className="space-y-3">
              <ComposerPreview onCreate={() => setShowCreate(true)} />
              {visiblePosts.map((post) => (
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
              {!visiblePosts.length && (
                <div className="border border-zinc-800 bg-black/50 p-8 text-center text-xs uppercase tracking-[0.12em] text-zinc-600">
                  No posts match this view
                </div>
              )}
              {loading && (
                <div className="flex h-16 items-center justify-center">
                  <div className="h-6 w-6 animate-spin border-2 border-zinc-800 border-t-sky-400" />
                </div>
              )}
              {nextCursor && !loading && (
                <button
                  type="button"
                  onClick={() => void fetchFeed(nextCursor)}
                  className="h-10 w-full border border-zinc-800 bg-black text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500 transition-colors hover:border-sky-400 hover:text-zinc-200"
                >
                  Load More
                </button>
              )}
            </div>
          )}
        </section>
      </div>
      </div>

      {showCreate && (
        <CreatePostDialog
          title={newPostTitle}
          body={newPostBody}
          flair={newPostFlair}
          onTitle={setNewPostTitle}
          onBody={setNewPostBody}
          onFlair={setNewPostFlair}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreatePost}
        />
      )}
    </div>
  );
}

function Header({
  variant,
  stats,
  usingMockData,
  onCreate,
  onClose,
}: {
  variant: Variant;
  stats: { posts: number; comments: number; shares: number };
  usingMockData: boolean;
  onCreate: () => void;
  onClose?: () => void;
}) {
  return (
    <div className={cn("relative overflow-hidden border-b border-zinc-800/90 bg-black/18", variant === "modal" ? "px-4 py-3" : "pb-5")}>
      <div className="pointer-events-none absolute right-0 top-0 h-full w-32 bg-[linear-gradient(135deg,transparent_0%,rgba(14,165,233,0.10)_42%,transparent_43%)]" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-px w-full bg-gradient-to-r from-sky-400/50 via-zinc-700/40 to-transparent" />
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-black uppercase tracking-[0.14em] text-zinc-100 sm:text-2xl">Community</h1>
            {usingMockData && (
              <span className="inline-flex items-center gap-1 border border-sky-400/40 bg-sky-950/30 px-2 py-1 text-[8px] font-black uppercase tracking-[0.12em] text-sky-200 shadow-[inset_0_0_16px_rgba(14,165,233,0.08)]">
                <Sparkles className="h-3 w-3" />
                Mock feed
              </span>
            )}
          </div>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
            Posts, comments, scenes and profile context
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden grid-cols-3 border border-zinc-800/90 bg-black/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] sm:grid">
            <Stat value={stats.posts} label="Posts" />
            <Stat value={stats.comments} label="Comments" />
            <Stat value={stats.shares} label="Shares" />
          </div>
          <button
            type="button"
            onClick={onCreate}
            className={cn("inline-flex h-9 items-center gap-2 border border-sky-400/50 bg-sky-950/30 px-3 text-[10px] font-black uppercase tracking-[0.12em] text-sky-100 hover:border-sky-300 hover:bg-sky-900/35 hover:text-white", focusClass, smoothClass)}
          >
            <Plus className="h-3.5 w-3.5" />
            Post
          </button>
          {variant === "modal" && onClose && (
            <button
              type="button"
              onClick={onClose}
              className={cn("inline-flex h-9 w-9 items-center justify-center border border-zinc-700 bg-black text-zinc-400 hover:border-sky-400 hover:text-white", focusClass, smoothClass)}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-20 border-r border-zinc-800/90 px-3 py-2 last:border-r-0">
      <div className="text-sm font-black tabular-nums text-zinc-100">{value}</div>
      <div className="text-[8px] font-black uppercase tracking-[0.12em] text-zinc-600">{label}</div>
    </div>
  );
}

function SharpBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:72px_72px] opacity-35" />
      <div
        className="absolute -right-16 top-20 h-44 w-72 border border-sky-400/10 bg-sky-400/[0.035]"
        style={{ clipPath: "polygon(16% 0, 100% 0, 84% 100%, 0 100%)" }}
      />
      <div
        className="absolute -left-20 bottom-12 h-32 w-64 border border-emerald-400/10 bg-emerald-400/[0.025]"
        style={{ clipPath: "polygon(0 0, 82% 0, 100% 100%, 18% 100%)" }}
      />
      <div
        className="absolute left-[48%] top-3 h-16 w-36 border border-zinc-700/30 bg-white/[0.018]"
        style={{ clipPath: "polygon(14% 0, 100% 0, 86% 100%, 0 100%)" }}
      />
    </div>
  );
}

function CornerCuts() {
  return (
    <>
      <span className="pointer-events-none absolute right-0 top-0 h-5 w-5 border-l border-b border-sky-400/20 bg-sky-400/[0.04]" style={{ clipPath: "polygon(100% 0, 100% 100%, 0 0)" }} />
      <span className="pointer-events-none absolute bottom-0 left-0 h-4 w-4 border-r border-t border-zinc-600/30 bg-white/[0.025]" style={{ clipPath: "polygon(0 0, 100% 100%, 0 100%)" }} />
    </>
  );
}

function SharpDivider() {
  return (
    <span
      className="pointer-events-none absolute right-2 top-2 h-10 w-16 border border-zinc-700/20 bg-white/[0.018]"
      style={{ clipPath: "polygon(18% 0, 100% 0, 82% 100%, 0 100%)" }}
    />
  );
}

function ComposerPreview({ onCreate }: { onCreate: () => void }) {
  return (
    <button
      type="button"
      onClick={onCreate}
      className={cn("group relative flex w-full items-center gap-3 overflow-hidden border border-zinc-800/90 bg-black/35 p-3 text-left hover:-translate-y-0.5 hover:border-sky-400/45 hover:bg-zinc-950/85", focusClass, smoothClass)}
    >
      <CornerCuts />
      <Avatar name="YOU" />
      <div className="min-w-0 flex-1 border border-zinc-800 bg-black/45 px-3 py-2 text-xs text-zinc-600 transition-colors duration-200 group-hover:border-zinc-700 group-hover:text-zinc-400">
        Start a post, log an update, or ask for feedback
      </div>
      <Send className="h-4 w-4 text-zinc-600 transition-colors duration-200 group-hover:text-sky-300" />
    </button>
  );
}

function CreatePostDialog({
  title,
  body,
  flair,
  onTitle,
  onBody,
  onFlair,
  onClose,
  onCreate,
}: {
  title: string;
  body: string;
  flair: string;
  onTitle: (value: string) => void;
  onBody: (value: string) => void;
  onFlair: (value: string) => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/75 p-3 backdrop-blur-sm sm:items-center">
      <div className={cn(panelClass, "relative w-full max-w-xl overflow-hidden p-4 shadow-[0_0_48px_rgba(14,165,233,0.13)]")}>
        <CornerCuts />
        <div className="flex items-center justify-between">
          <span className="text-sm font-black uppercase tracking-[0.12em] text-zinc-100">Create Post</span>
          <button type="button" onClick={onClose} className={cn("text-zinc-500 hover:text-white", focusClass, smoothClass)}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <input
            type="text"
            value={title}
            onChange={(event) => onTitle(event.target.value)}
            placeholder="Title"
            className={cn("h-10 w-full border border-zinc-800 bg-black/65 px-3 text-sm font-semibold text-zinc-200 placeholder:text-zinc-700", focusClass, smoothClass)}
          />
          <textarea
            value={body}
            onChange={(event) => onBody(event.target.value)}
            placeholder="What happened? Add context, scene, or feedback target."
            rows={6}
            className={cn("w-full resize-none border border-zinc-800 bg-black/65 px-3 py-2 text-sm leading-relaxed text-zinc-200 placeholder:text-zinc-700", focusClass, smoothClass)}
          />
          <div className="flex flex-wrap gap-1.5">
            {FLAIRS.filter((item) => item.key !== "all").map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onFlair(item.key)}
                className={cn(
                  "border px-2.5 py-1.5 text-[9px] font-black uppercase tracking-[0.08em]",
                  focusClass,
                  smoothClass,
                  flair === item.key ? item.accent : "border-zinc-800 text-zinc-600 hover:border-zinc-700 hover:bg-black/50 hover:text-zinc-300",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onCreate}
            disabled={!title.trim() || !body.trim()}
            className={cn("inline-flex h-10 w-full items-center justify-center gap-2 border border-sky-400/50 bg-sky-950/30 text-[10px] font-black uppercase tracking-[0.12em] text-sky-100 hover:border-sky-300 hover:bg-sky-900/35 hover:text-white disabled:opacity-30", focusClass, smoothClass)}
          >
            <Send className="h-3.5 w-3.5" />
            Publish
          </button>
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
  const flair = FLAIRS.find((item) => item.key === post.flair) ?? FLAIRS[FLAIRS.length - 1];
  const score = scorePost(post);

  return (
    <article className={cn("group relative overflow-hidden border bg-black/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] hover:-translate-y-0.5 hover:bg-zinc-950/80", smoothClass, post.is_pinned ? "border-amber-400/35" : "border-zinc-800 hover:border-zinc-700")}>
      <CornerCuts />
      {post.is_pinned && (
        <div className="flex items-center gap-1.5 border-b border-amber-400/20 bg-amber-950/20 px-3 py-1.5">
          <Award className="h-3 w-3 text-amber-300" />
          <span className="text-[8px] font-black uppercase tracking-[0.12em] text-amber-200">Pinned discussion</span>
        </div>
      )}
      <div className="grid grid-cols-[44px_minmax(0,1fr)]">
        <VoteRail vote={post.my_vote} score={score} onVote={onVote} />
        <div className="min-w-0 p-3 sm:p-4">
          <AuthorLine post={post} onOpenProfile={onOpenProfile} flairClass={flair.accent} flairLabel={flair.label} />
          <button type="button" onClick={onOpen} className={cn("mt-3 block w-full text-left", focusClass)}>
            <h2 className="text-base font-black uppercase tracking-[0.06em] text-zinc-100 transition-colors duration-200 group-hover:text-white">{post.title}</h2>
            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-zinc-400">{post.body}</p>
          </button>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <ActionButton onClick={onOpen} icon={MessageSquare} label={`${post.comment_count} comments`} />
            <ActionButton onClick={onShare} icon={Share2} label={`${post.share_count} shares`} />
            <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-700">{formatRelative(post.created_at)}</span>
            {canDelete(post.author_user_id) && (
              <button type="button" onClick={onDelete} className={cn("ml-auto text-zinc-700 hover:text-red-400", focusClass, smoothClass)}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
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
  onCommentText: (value: string) => void;
  onReplyTo: (value: string | null) => void;
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
  const flair = FLAIRS.find((item) => item.key === post.flair) ?? FLAIRS[FLAIRS.length - 1];
  const rootComments = comments.filter((comment) => !comment.parent_comment_id);
  const repliesByParent = comments.reduce<Record<string, CommunityComment[]>>((acc, comment) => {
    if (comment.parent_comment_id) acc[comment.parent_comment_id] = [...(acc[comment.parent_comment_id] ?? []), comment];
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className={cn("inline-flex h-8 items-center gap-1 border border-zinc-800 bg-black/40 px-2 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500 hover:-translate-x-0.5 hover:border-sky-400/50 hover:text-zinc-200", focusClass, smoothClass)}
      >
        <ChevronLeft className="h-3 w-3" />
        Feed
      </button>

      <article className={cn(panelClass, "relative overflow-hidden")}>
        <CornerCuts />
        <div className="grid grid-cols-[44px_minmax(0,1fr)]">
          <VoteRail vote={post.my_vote} score={scorePost(post)} onVote={(vote) => onVotePost(post.id, post.my_vote, vote)} />
          <div className="min-w-0 p-4">
            <AuthorLine post={post} onOpenProfile={onOpenProfile} flairClass={flair.accent} flairLabel={flair.label} />
            <h2 className="mt-4 text-xl font-black uppercase tracking-[0.06em] text-zinc-100">{post.title}</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-zinc-300">{post.body}</p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="inline-flex h-8 items-center gap-1.5 border border-zinc-800 bg-black/45 px-2 text-[9px] font-black uppercase tracking-[0.1em] text-zinc-500">
                <MessageSquare className="h-3 w-3" />
                {post.comment_count} comments
              </span>
              <ActionButton onClick={() => onShare(post.id)} icon={Share2} label={`${post.share_count} shares`} />
              {canDelete(post.author_user_id) && (
                <button type="button" onClick={() => onDeletePost(post.id)} className={cn("ml-auto text-zinc-700 hover:text-red-400", focusClass, smoothClass)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </article>

      <div className={cn(panelClass, "relative overflow-hidden p-3")}>
        <CornerCuts />
        {replyTo && (
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[9px] font-black uppercase tracking-[0.1em] text-sky-200">Replying to comment</span>
            <button type="button" onClick={() => onReplyTo(null)} className={cn("text-zinc-600 hover:text-white", focusClass, smoothClass)}>
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={commentText}
            onChange={(event) => onCommentText(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && onCreateComment()}
            placeholder={replyTo ? "Write a reply" : "Write a comment"}
            className={cn("min-w-0 flex-1 border border-zinc-800 bg-black/60 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-700", focusClass, smoothClass)}
          />
          <button
            type="button"
            onClick={onCreateComment}
            disabled={!commentText.trim()}
            className={cn("inline-flex h-9 items-center border border-sky-400/50 bg-sky-950/30 px-3 text-sky-100 hover:border-sky-300 hover:bg-sky-900/35 hover:text-white disabled:opacity-30", focusClass, smoothClass)}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-3">
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

function AuthorLine({
  post,
  onOpenProfile,
  flairClass,
  flairLabel,
}: {
  post: CommunityPost;
  onOpenProfile: (id: string) => void;
  flairClass: string;
  flairLabel: string;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <button type="button" onClick={() => onOpenProfile(post.author_user_id)} className={cn("flex min-w-0 items-center gap-2 hover:opacity-80", focusClass, smoothClass)}>
        <Avatar name={post.author_nickname} src={post.author_avatar_url} />
        <span className="truncate text-[10px] font-black uppercase tracking-[0.1em] text-zinc-200">{post.author_nickname}</span>
      </button>
      {post.author_rank && (
        <span className={cn("inline-flex border px-1.5 py-0.5 text-[7px] font-black uppercase tracking-[0.06em]", getRankClass(formatRankLabel(post.author_rank)))}>
          {formatRankLabel(post.author_rank)}
        </span>
      )}
      <span className={cn("ml-auto inline-flex border px-2 py-1 text-[8px] font-black uppercase tracking-[0.08em] shadow-[inset_0_0_14px_rgba(255,255,255,0.03)]", flairClass)}>
        {flairLabel}
      </span>
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
  return (
    <div className={cn(panelClass, "relative overflow-hidden")}>
      <CornerCuts />
      <CommentItem comment={comment} onVote={onVote} onReply={onReply} onDelete={onDelete} onOpenProfile={onOpenProfile} canDelete={canDelete} />
      {replies.length > 0 && (
        <div className="border-t border-zinc-800 bg-black/30 pl-6">
          {replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              compact
              onVote={onVote}
              onDelete={onDelete}
              onOpenProfile={onOpenProfile}
              canDelete={canDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CommentItem({
  comment,
  compact = false,
  onVote,
  onReply,
  onDelete,
  onOpenProfile,
  canDelete,
}: {
  comment: CommunityComment;
  compact?: boolean;
  onVote: (id: string, current: number, target: number) => void;
  onReply?: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenProfile: (id: string) => void;
  canDelete: (authorId: string) => boolean;
}) {
  const score = comment.like_count - comment.dislike_count;

  return (
    <div className="grid grid-cols-[36px_minmax(0,1fr)] border-b border-zinc-800/60 last:border-b-0">
      <VoteRail compact vote={comment.my_vote} score={score} onVote={(vote) => onVote(comment.id, comment.my_vote, vote)} />
      <div className={cn("min-w-0", compact ? "p-2.5" : "p-3")}>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => onOpenProfile(comment.author_user_id)} className={cn("text-[9px] font-black uppercase tracking-[0.08em] text-zinc-300 hover:text-white", focusClass, smoothClass)}>
            {comment.author_nickname}
          </button>
          {comment.author_rank && (
            <span className={cn("inline-flex border px-1 py-0 text-[6px] font-black uppercase", getRankClass(formatRankLabel(comment.author_rank)))}>
              {formatRankLabel(comment.author_rank)}
            </span>
          )}
          <span className="text-[8px] font-semibold uppercase tracking-[0.08em] text-zinc-700">{formatRelative(comment.created_at)}</span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{comment.text}</p>
        <div className="mt-2 flex items-center gap-3">
          {onReply && (
            <button type="button" onClick={() => onReply(comment.id)} className="text-[8px] font-black uppercase tracking-[0.1em] text-zinc-600 hover:text-zinc-300">
              Reply
            </button>
          )}
          {canDelete(comment.author_user_id) && (
            <button type="button" onClick={() => onDelete(comment.id)} className={cn("text-zinc-700 hover:text-red-400", focusClass, smoothClass)}>
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function VoteRail({
  vote,
  score,
  compact = false,
  onVote,
}: {
  vote: number;
  score: number;
  compact?: boolean;
  onVote: (vote: 1 | -1) => void;
}) {
  return (
    <div className={cn("flex flex-col items-center border-r border-zinc-800/90 bg-black/18", compact ? "py-1" : "py-3")}>
      <button type="button" onClick={() => onVote(1)} className={cn(focusClass, smoothClass, vote === 1 ? "text-sky-300" : "text-zinc-700 hover:-translate-y-0.5 hover:text-zinc-300")}>
        <ArrowBigUp className={compact ? "h-5 w-5" : "h-6 w-6"} />
      </button>
      <span className={cn("font-black tabular-nums", compact ? "text-[10px]" : "text-xs", score > 0 ? "text-sky-300" : score < 0 ? "text-rose-300" : "text-zinc-600")}>
        {score}
      </span>
      <button type="button" onClick={() => onVote(-1)} className={cn(focusClass, smoothClass, vote === -1 ? "text-rose-300" : "text-zinc-700 hover:translate-y-0.5 hover:text-zinc-300")}>
        <ArrowBigDown className={compact ? "h-5 w-5" : "h-6 w-6"} />
      </button>
    </div>
  );
}

function ActionButton({
  onClick,
  icon: Icon,
  label,
}: {
  onClick: () => void;
  icon: typeof MessageSquare;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("inline-flex h-8 items-center gap-1.5 border border-zinc-800 bg-black/45 px-2 text-[9px] font-black uppercase tracking-[0.1em] text-zinc-500 hover:border-sky-400/50 hover:bg-zinc-900/70 hover:text-zinc-200", focusClass, smoothClass)}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

function Avatar({ name, src }: { name: string; src?: string }) {
  if (src) {
    return <Image src={src} alt="" width={28} height={28} className="h-7 w-7 border border-zinc-700 object-cover" />;
  }

  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-zinc-700 bg-[linear-gradient(135deg,rgba(14,165,233,0.16),rgba(24,24,27,0.95)_48%,rgba(16,185,129,0.10))] text-[10px] font-black uppercase text-zinc-200 shadow-[inset_0_0_14px_rgba(255,255,255,0.035)]">
      {name.trim().charAt(0) || <User className="h-3 w-3" />}
    </span>
  );
}

function scorePost(post: Pick<CommunityPost, "like_count" | "dislike_count">) {
  return post.like_count - post.dislike_count;
}

function heatPost(post: CommunityPost) {
  const hoursOld = Math.max(1, (Date.now() - new Date(post.created_at).getTime()) / 36e5);
  return scorePost(post) * 2 + post.comment_count * 3 + post.share_count * 1.5 - hoursOld * 0.35 + (post.is_pinned ? 1000 : 0);
}

function updatePostVote(post: CommunityPost, vote: number, currentVote: number): CommunityPost {
  return {
    ...post,
    my_vote: vote,
    like_count: post.like_count + voteDelta(1, vote, currentVote),
    dislike_count: post.dislike_count + voteDelta(-1, vote, currentVote),
  };
}

function updateCommentVote(comments: CommunityComment[], commentID: string, vote: number, currentVote: number): CommunityComment[] {
  return comments.map((comment) =>
    comment.id === commentID
      ? {
          ...comment,
          my_vote: vote,
          like_count: comment.like_count + voteDelta(1, vote, currentVote),
          dislike_count: comment.dislike_count + voteDelta(-1, vote, currentVote),
        }
      : comment,
  );
}

function voteDelta(kind: 1 | -1, vote: number, currentVote: number) {
  return (vote === kind ? 1 : 0) - (currentVote === kind ? 1 : 0);
}

function formatRelative(date: string) {
  const diffMinutes = Math.max(1, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}
