"use client";

import { useRouter } from "next/navigation";
import { CommunityExperience } from "@/components/community/CommunityExperience";

export function CommunityPageClient() {
  const router = useRouter();

  return <CommunityExperience onOpenProfile={(userID) => router.push(`/?profile=${userID}`)} />;
}
