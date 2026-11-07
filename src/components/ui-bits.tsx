"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import { platformTone, STATUS_META, titleGradient } from "@/lib/constants";
import type { LibraryGame } from "@/db/schema";
import type { GameStatus } from "@/lib/types";

export function CoverArt({
  game,
  sizes,
  className = "",
  priority = false,
}: {
  game: Pick<LibraryGame, "title" | "coverUrl">;
  sizes?: string;
  className?: string;
  priority?: boolean;
}) {
  void sizes;
  const [broken, setBroken] = useState(false);
  const url = game.coverUrl;
  return url && !broken ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={`Cover art for ${game.title}`}
      loading={priority ? "eager" : "lazy"}
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className={`h-full w-full object-cover ${className}`}
    />
  ) : (
    <div
      className={`flex h-full w-full items-center justify-center ${className}`}
      style={{ background: titleGradient(game.title) }}
      aria-hidden="true"
    >
      <span className="font-display px-3 text-center text-xl leading-tight text-white/70">
        {game.title.slice(0, 2).toUpperCase()}
      </span>
    </div>
  );
}

export function PlatformDot({ label, className = "" }: { label: string; className?: string }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full ${className}`}
      style={{ background: platformTone(label) }}
    />
  );
}

export function PlatformBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] font-medium tracking-[0.14em] text-white/80 uppercase">
      <PlatformDot label={label} />
      {label}
    </span>
  );
}

export function StatusPill({ status, size = "md" }: { status: GameStatus; size?: "sm" | "md" }) {
  const meta = STATUS_META[status] ?? STATUS_META.backlog;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-mono font-medium tracking-[0.14em] uppercase ${
        size === "sm" ? "px-2 py-0.5 text-[9px]" : "px-2.5 py-1 text-[10px]"
      }`}
      style={{
        color: meta.color,
        borderColor: `${meta.color}40`,
        background: `${meta.color}14`,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: meta.color }}
      />
      {meta.label}
    </span>
  );
}

/** Micro 10-segment rating bar. */
export function RatingBar({
  rating,
  color = "#c8ff3e",
  className = "",
}: {
  rating: number | null;
  color?: string;
  className?: string;
}) {
  return (
    <span className={`flex items-center gap-3 ${className}`}>
      <span className="flex items-end gap-[3px]" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            className="w-[3px] rounded-sm"
            style={{
              height: `${6 + i * 1.1}px`,
              background:
                rating !== null && i < rating ? color : "rgba(255,255,255,0.14)",
            }}
          />
        ))}
      </span>
      <span className="tabular font-mono text-xs text-white/70">
        {rating !== null ? rating.toFixed(0) : "—"}
        <span className="text-white/30">/10</span>
      </span>
    </span>
  );
}

export function FavoriteButton({
  active,
  onToggle,
  className = "",
  size = 16,
}: {
  active: boolean;
  onToggle: (e?: React.MouseEvent) => void;
  className?: string;
  size?: number;
}) {
  return (
    <button
      type="button"
      aria-label={active ? "Remove from favorites" : "Add to favorites"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(e);
      }}
      className={`grid place-items-center rounded-full border transition-all duration-200 ${
        active
          ? "border-pink/40 bg-pink/15 text-pink"
          : "border-white/10 bg-black/40 text-white/60 hover:border-white/30 hover:text-white"
      } ${className}`}
    >
      <Heart size={size} fill={active ? "currentColor" : "none"} strokeWidth={2} />
    </button>
  );
}

export function CriticScore({ score }: { score: number | null }) {
  if (score === null) return null;
  const color = score >= 75 ? "#c8ff3e" : score >= 55 ? "#ffb84d" : "#ff5c5c";
  return (
    <span
      className="tabular inline-flex items-baseline gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold"
      style={{ color, borderColor: `${color}45`, background: `${color}12` }}
      title="Critics' score"
    >
      {score}
      <span className="text-[9px] opacity-60">/100</span>
    </span>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] font-medium tracking-[0.28em] text-ink-dim uppercase">
      {children}
    </p>
  );
}
