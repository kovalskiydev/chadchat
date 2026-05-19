import type { Metadata } from "next";
import { CommunityPageClient } from "./CommunityPageClient";

export const metadata: Metadata = {
  title: "Community — Chadchat",
  description: "Community feed for posts, comments, profile scenes, duels, and looksmax logs.",
};

export default function CommunityPage() {
  return <CommunityPageClient />;
}
