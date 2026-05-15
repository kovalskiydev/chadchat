import type React from "react";
import { cn } from "@/lib/utils";
import { magicBlockClass, magicGlow } from "@/lib/constants";
import { ParticleCard } from "@/components/MagicBento";

export function MagicButton({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  return (
    <ParticleCard
      className={cn(magicBlockClass, className)}
      particleCount={12}
      glowColor={magicGlow}
      enableTilt={false}
      enableMagnetism={false}
      clickEffect
    >
      {children}
    </ParticleCard>
  );
}
