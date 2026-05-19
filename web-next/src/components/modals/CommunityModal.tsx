"use client";

import { CommunityExperience } from "@/components/community/CommunityExperience";

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
  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/80 p-2 backdrop-blur-sm sm:p-4">
      <div className="h-full w-full max-w-5xl">
        <CommunityExperience
          variant="modal"
          onClose={onClose}
          onOpenProfile={onOpenProfile}
          myUserId={myUserId}
          myRole={myRole}
        />
      </div>
    </div>
  );
}
