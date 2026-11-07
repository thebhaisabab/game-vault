"use client";

import { motion } from "framer-motion";
import type { LibraryGame } from "@/db/schema";
import { STATUS_META } from "@/lib/constants";
import { CoverArt, FavoriteButton, PlatformDot } from "./ui-bits";

export default function GameCard({
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
  const statusColor = STATUS_META[game.status]?.color ?? "#9a9aa6";

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{
        duration: 0.45,
        delay: Math.min(index * 0.03, 0.4),
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={{ y: -6 }}
      onClick={onOpen}
      className="group focus-visible:outline-volt relative block w-full cursor-pointer rounded-xl text-left"
      aria-label={`Open ${game.title} details`}
    >
      <div className="cover-shine relative aspect-[3/4] overflow-hidden rounded-xl border border-white/10 bg-panel-2 transition-all duration-300 group-hover:border-white/30 group-hover:shadow-[0_24px_50px_-18px_rgba(0,0,0,0.9)]">
        <div className="absolute inset-0 transition-transform duration-500 ease-out group-hover:scale-[1.06]">
          <CoverArt game={game} />
        </div>

        {/* status strip */}
        <div
          className="absolute inset-x-0 bottom-0 h-1 transition-opacity"
          style={{ background: statusColor }}
        />

        {/* top meta */}
        <div className="absolute top-2 right-2 left-2 flex items-start justify-between">
          <span className="tabular rounded-md border border-white/15 bg-black/55 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white/85 backdrop-blur-sm">
            {game.releaseYear ?? "TBA"}
          </span>
          <FavoriteButton
            active={game.favorite}
            onToggle={onToggleFavorite}
            className="h-7 w-7 backdrop-blur-sm"
            size={13}
          />
        </div>

        {/* bottom gradient + info */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-2.5 pt-10">
          <p className="line-clamp-2 text-[13px] leading-tight font-semibold text-white">
            {game.title}
          </p>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 font-mono text-[9px] tracking-[0.14em] text-white/55 uppercase">
              {game.platform && (
                <>
                  <PlatformDot label={game.platform} />
                  <span className="truncate">{game.platform}</span>
                </>
              )}
              {!game.platform && game.genres?.[0] && (
                <span className="truncate">{game.genres[0]}</span>
              )}
            </span>
            {game.rating !== null && (
              <span className="tabular shrink-0 font-mono text-[10px] font-semibold text-volt">
                {game.rating}
                <span className="text-white/35">/10</span>
              </span>
            )}
          </div>
        </div>

        {/* hover status tag */}
        <div
          className="absolute top-2 left-1/2 -translate-x-1/2 translate-y-1 rounded-full px-2 py-0.5 font-mono text-[9px] tracking-[0.16em] uppercase opacity-0 backdrop-blur transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100"
          style={{ background: `${statusColor}22`, color: statusColor }}
        >
          {STATUS_META[game.status]?.label}
        </div>
      </div>
    </motion.button>
  );
}
