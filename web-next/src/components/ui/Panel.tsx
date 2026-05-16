import type React from "react";
import { cn } from "@/lib/utils";
import { magicBlockClass, magicGlow } from "@/lib/constants";
import { ParticleCard } from "@/components/MagicBento";

export function Panel({
  title,
  icon,
  headerAction,
  children,
  className,
}: {
  title: string;
  icon: React.ReactNode;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <ParticleCard
      className={cn(
        magicBlockClass,
        "h-[calc(100vh-7.5rem)] min-h-[320px] overflow-hidden shadow-wire",
        className,
      )}
      particleCount={12}
      glowColor={magicGlow}
      enableTilt={false}
      enableMagnetism={false}
      clickEffect
    >
      <aside
        className="flex h-full min-h-0 flex-col overflow-hidden border border-border"
      >
        <div className="flex h-12 items-center justify-between border-b border-border px-4 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">
          <span>{title}</span>
          <div className="flex items-center gap-2">
            {headerAction}
            <span className="text-zinc-600">{icon}</span>
          </div>
        </div>
        {children}
      </aside>
    </ParticleCard>
  );
}
