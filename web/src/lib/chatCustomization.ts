import { authorizedRequest } from "@/lib/auth";

type JsonRecord = Record<string, unknown>;

export type ChatCustomizationSlot =
  | "title"
  | "nickname_color"
  | "text_style"
  | "title_frame"
  | "avatar"
  | "badge";

export type ChatCustomizationPreview = {
  label?: string;
  color?: string;
  colors?: string[];
  gradient?: string[];
  animated?: boolean;
  css_class?: string;
  frame?: string;
  frame_color?: string;
  shape?: string;
  url?: string;
  [key: string]: unknown;
};

export type ChatCustomizationItem = {
  id: string;
  type?: ChatCustomizationSlot | string;
  title: string;
  description?: string | null;
  rarity?: string | null;
  owned: boolean;
  selected?: boolean;
  locked_reason?: string | null;
  price_aura?: number | null;
  preview?: ChatCustomizationPreview | null;
};

export type ChatCustomizationCatalog = {
  titles: ChatCustomizationItem[];
  nickname_colors: ChatCustomizationItem[];
  text_styles: ChatCustomizationItem[];
  title_frames: ChatCustomizationItem[];
  avatars: ChatCustomizationItem[];
  badges: ChatCustomizationItem[];
};

export type ChatCustomizationSelection = {
  title_id?: string | null;
  nickname_color_id?: string | null;
  text_style_id?: string | null;
  title_frame_id?: string | null;
  avatar_id?: string | null;
  badge_ids?: string[];
};

function normalizeItems(value: unknown): ChatCustomizationItem[] {
  if (!Array.isArray(value)) return [];
  return value.reduce<ChatCustomizationItem[]>((items, raw) => {
      if (!raw || typeof raw !== "object") return items;
      const item = raw as JsonRecord;
      const id = item.id ?? item.item_id;
      if (!id) return items;
      items.push({
        id: String(id),
        type: typeof item.type === "string" ? item.type : undefined,
        title: String(item.title ?? item.label ?? item.name ?? id),
        description:
          typeof item.description === "string" ? item.description : null,
        rarity: typeof item.rarity === "string" ? item.rarity : null,
        owned: Boolean(item.owned),
        selected: Boolean(item.selected),
        locked_reason:
          typeof item.locked_reason === "string" ? item.locked_reason : null,
        price_aura:
          typeof item.price_aura === "number" ? item.price_aura : null,
        preview:
          item.preview && typeof item.preview === "object"
            ? (item.preview as ChatCustomizationPreview)
            : null,
      });
      return items;
    }, []);
}

function normalizeCatalog(payload: JsonRecord): ChatCustomizationCatalog {
  const catalog = (payload.catalog && typeof payload.catalog === "object"
    ? payload.catalog
    : payload) as JsonRecord;

  return {
    titles: normalizeItems(catalog.titles),
    nickname_colors: normalizeItems(catalog.nickname_colors),
    text_styles: normalizeItems(catalog.text_styles),
    title_frames: normalizeItems(catalog.title_frames),
    avatars: normalizeItems(catalog.avatars),
    badges: normalizeItems(catalog.badges),
  };
}

function normalizeSelection(payload: JsonRecord): ChatCustomizationSelection {
  const selected = (payload.selected && typeof payload.selected === "object"
    ? payload.selected
    : payload) as JsonRecord;

  return {
    title_id:
      selected.title_id !== undefined ? String(selected.title_id) : null,
    nickname_color_id:
      selected.nickname_color_id !== undefined
        ? String(selected.nickname_color_id)
        : null,
    text_style_id:
      selected.text_style_id !== undefined ? String(selected.text_style_id) : null,
    title_frame_id:
      selected.title_frame_id !== undefined
        ? String(selected.title_frame_id)
        : null,
    avatar_id:
      selected.avatar_id !== undefined ? String(selected.avatar_id) : null,
    badge_ids: Array.isArray(selected.badge_ids)
      ? selected.badge_ids.map(String)
      : [],
  };
}

export async function getChatCustomizationCatalog(accessToken: string) {
  const payload = await authorizedRequest<JsonRecord>(
    "/chat-customization/catalog",
    { method: "GET" },
    accessToken,
  );
  return normalizeCatalog(payload);
}

export async function getMyChatCustomization(accessToken: string) {
  const payload = await authorizedRequest<JsonRecord>(
    "/chat-customization/me",
    { method: "GET" },
    accessToken,
  );
  return normalizeSelection(payload);
}

export async function selectChatCustomizationItem(
  accessToken: string,
  slot: ChatCustomizationSlot,
  itemID: string,
) {
  const payload = await authorizedRequest<JsonRecord>(
    "/chat-customization/select",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot, item_id: itemID }),
    },
    accessToken,
  );
  return normalizeSelection(payload);
}

export async function clearChatCustomizationSlot(
  accessToken: string,
  slot: ChatCustomizationSlot,
) {
  const payload = await authorizedRequest<JsonRecord>(
    "/chat-customization/clear",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot }),
    },
    accessToken,
  );
  return normalizeSelection(payload);
}
