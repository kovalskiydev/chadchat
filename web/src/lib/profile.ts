import { authorizedRequest } from "@/lib/auth";

export type ProfileBadge = {
  id?: string;
  label?: string;
  color?: string;
  icon?: string;
};

export type Profile = {
  user_id: string;
  nickname?: string;
  type?: string;
  role?: string;
  avatar_url?: string;
  country_code?: string;
  bio?: string;
  member_since?: string;
  account_age_days?: number;
  rating?: number;
  peak_rating?: number;
  rank?: string;
  next_rank?: string;
  progress_percent?: number;
  wins?: number;
  losses?: number;
  matches?: number;
  win_rate?: number;
  streak?: number;
  average_score?: number;
  best_score?: number;
  recent_score?: number;
  test_lab_best?: number;
  test_lab_average?: number;
  recent_form?: string[];
  last_match_at?: string | null;
  favorite_mode?: string;
  avg_opponent_rating?: number;
  best_win_rating_delta?: number;
  worst_loss_rating_delta?: number;
  selected_title?: {
    label?: string;
    colors?: string[];
    color?: string;
    animated?: boolean;
    css_class?: string;
  } | null;
  selected_badges?: ProfileBadge[];
  nickname_style?: {
    color?: string;
    gradient?: string[];
    animated?: boolean;
    font_weight?: number;
  } | null;
  avatar_frame?: {
    frame?: string;
    frame_color?: string;
  } | null;
};

export type ProfileComment = {
  id: string;
  author_user_id: string;
  author_nickname: string;
  target_user_id: string;
  parent_comment_id?: string | null;
  text: string;
  is_deleted?: boolean;
  created_at: string;
};

export type AvatarUploadRequest = {
  file_name: string;
  content_type: string;
  file_size: number;
};

export type AvatarUploadResponse = {
  upload_url: string;
  file_url: string;
  object_key?: string;
  method?: string;
  headers?: Record<string, string>;
  expires_in_sec?: number;
};

type ProfilePayload = {
  profile?: Profile;
};

export async function getMyProfile(accessToken: string) {
  const payload = await authorizedRequest<ProfilePayload>(
    "/profiles/me",
    undefined,
    accessToken,
  );
  return payload.profile ?? null;
}

export async function updateMyProfile(
  accessToken: string,
  body: {
    avatar_url?: string;
    country_code?: string;
    bio?: string;
  },
) {
  const payload = await authorizedRequest<ProfilePayload>(
    "/profiles/me",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    accessToken,
  );
  return payload.profile ?? null;
}

export async function createAvatarUpload(
  accessToken: string,
  body: AvatarUploadRequest,
) {
  return authorizedRequest<AvatarUploadResponse>(
    "/profiles/me/avatar-upload",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    accessToken,
  );
}

export async function getPublicProfile(accessToken: string, userID: string) {
  const payload = await authorizedRequest<ProfilePayload>(
    `/profiles/${encodeURIComponent(userID)}`,
    undefined,
    accessToken,
  );
  return payload.profile ?? null;
}

export async function getProfileComments(
  accessToken: string,
  userID: string,
  limit = 20,
  cursor?: string,
) {
  const params = new URLSearchParams({
    limit: String(Math.max(1, Math.min(100, limit))),
  });
  if (cursor) params.set("cursor", cursor);
  const payload = await authorizedRequest<{
    comments?: ProfileComment[];
    next_cursor?: string;
  }>(
    `/profiles/${encodeURIComponent(userID)}/comments?${params.toString()}`,
    undefined,
    accessToken,
  );
  return {
    comments: payload.comments ?? [],
    nextCursor: payload.next_cursor ?? "",
  };
}

export async function postProfileComment(
  accessToken: string,
  userID: string,
  text: string,
  parentCommentID?: string | null,
) {
  const payload = await authorizedRequest<{ comment?: ProfileComment }>(
    `/profiles/${encodeURIComponent(userID)}/comments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        ...(parentCommentID ? { parent_comment_id: parentCommentID } : {}),
      }),
    },
    accessToken,
  );
  return payload.comment ?? null;
}

export async function deleteProfileComment(
  accessToken: string,
  userID: string,
  commentID: string,
) {
  await authorizedRequest(
    `/profiles/${encodeURIComponent(userID)}/comments/${encodeURIComponent(commentID)}`,
    {
      method: "DELETE",
    },
    accessToken,
  );
}
