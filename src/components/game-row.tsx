"use client";

import { motion } from "framer-motion";
import { Clock3 } from "lucide-react";
import type { LibraryGame } from "@/db/schema";
import {
  CoverArt,
  CriticScore,
  FavoriteButton,
  PlatformDot,
  RatingBar,
  StatusPill,
} from "./ui-bits";

export default function GameRow({
  game,
  index,
  onOpen,
  onToggleFavorite,
}: {
  game: LibraryGame;
  index: number;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -14 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.02, 0.3) }}
      onClick={onOpen}
      className="group grid cursor-pointer grid-cols-[44px_1fr_auto] items-center gap-3 rounded-xl border border-transparent px-2 py-2.5 transition-all hover:border-white/10 hover:bg-white/[0.04] sm:grid-cols-[44px_1.5fr_1fr_auto_auto] sm:gap-5 sm:px-4"
    >
      {/* cover */}
      <div className="h-14 w-11 shrink-0 overflow-hidden rounded-md border border-white/10 bg-panel-2">
        <CoverArt game={game} />
      </div>

      {/* title + genre */}
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold text-ink group-hover:text-volt">
          {game.title}
        </p>
        <p className="mt-0.5 flex items-center gap-2 truncate font-mono text-[10px] tracking-[0.12em] text-white/40 uppercase">
          <span>{game.releaseYear ?? "TBA"}</span>
          {game.genres && game.genres.length > 0 && (
            <>
              <span className="text-white/20">·</span>
              <span className="truncate">{game.genres.slice(0, 2).join(" / ")}</span>
            </>
          )}
        </p>
      </div>

      {/* platform */}
      <div className="hidden min-w-0 items-center gap-2 font-mono text-[11px] tracking-[0.12em] text-white/65 uppercase sm:flex">
        {game.platform ? (
          <>
            <PlatformDot label={game.platform} />
            <span className="truncate">{game.platform}</span>
          </>
        ) : (
          <span className="text-white/25">—</span>
        )}
      </div>

      {/* status + rating stack */}
      <div className="hidden flex-col items-end gap-1 sm:flex">
        <StatusPill status={game.status} size="sm" />
        <RatingBar rating={game.rating} />
      </div>

      {/* right */}
      <div className="flex items-center gap-3">
        {game.hoursPlayed ? (
          <span className="tabular hidden items-center gap-1 font-mono text-[10px] text-white/45 md:flex">
            <Clock3 size={11} />
            {game.hoursPlayed}h
          </span>
        ) : null}
        <CriticScore score={game.criticScore} />
        <FavoriteButton
          active={game.favorite}
          onToggle={onToggleFavorite}
          className="h-7 w-7"
          size={13}
        />
      </div>
    </motion.div>
  );
}
