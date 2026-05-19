import { authorizedRequest } from "@/lib/auth";

export type CommunityPost = {
  id: string;
  author_user_id: string;
  author_nickname: string;
  author_avatar_url?: string;
  author_rank?: string;
  author_role?: string;
  title: string;
  body: string;
  media_urls?: string[];
  flair?: string;
  like_count: number;
  dislike_count: number;
  comment_count: number;
  share_count: number;
  my_vote: number;
  is_pinned: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
};

export type CommunityComment = {
  id: string;
  post_id: string;
  author_user_id: string;
  author_nickname: string;
  author_avatar_url?: string;
  author_rank?: string;
  parent_comment_id?: string | null;
  text: string;
  like_count: number;
  dislike_count: number;
  my_vote: number;
  is_deleted: boolean;
  created_at: string;
  replies?: CommunityComment[];
};

export type CommunityFeed = {
  posts: CommunityPost[];
  next_cursor: string;
};

export type CreatePostRequest = {
  title: string;
  body: string;
  media_urls?: string[];
  flair?: string;
};

export type CreateCommentRequest = {
  text: string;
  parent_comment_id?: string;
};

export async function getCommunityFeed(cursor = "", limit = 20): Promise<CommunityFeed> {
  const params = new URLSearchParams({ limit: String(limit), cursor });
  return authorizedRequest(`/community/feed?${params.toString()}`);
}

export async function getCommunityPost(postID: string): Promise<{ post: CommunityPost; comments: CommunityComment[] }> {
  return authorizedRequest(`/community/posts/${postID}`);
}

export async function createCommunityPost(data: CreatePostRequest): Promise<CommunityPost> {
  return authorizedRequest("/community/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function voteCommunityPost(postID: string, vote: 1 | -1 | 0): Promise<void> {
  await authorizedRequest(`/community/posts/${postID}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vote }),
  });
}

export async function createCommunityComment(postID: string, data: CreateCommentRequest): Promise<CommunityComment> {
  return authorizedRequest(`/community/posts/${postID}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function voteCommunityComment(commentID: string, vote: 1 | -1 | 0): Promise<void> {
  await authorizedRequest(`/community/comments/${commentID}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vote }),
  });
}

export async function shareCommunityPost(postID: string): Promise<{ share_count: number }> {
  return authorizedRequest(`/community/posts/${postID}/share`, { method: "POST" });
}

export async function deleteCommunityPost(postID: string): Promise<void> {
  await authorizedRequest(`/community/posts/${postID}`, { method: "DELETE" });
}

export async function deleteCommunityComment(commentID: string): Promise<void> {
  await authorizedRequest(`/community/comments/${commentID}`, { method: "DELETE" });
}
