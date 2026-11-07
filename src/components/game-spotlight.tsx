"use client";

import { motion } from "framer-motion";
import { Clock3, Layers } from "lucide-react";
import type { LibraryGame } from "@/db/schema";
import { STATUS_META } from "@/lib/constants";
import {
  CoverArt,
  CriticScore,
  FavoriteButton,
  PlatformBadge,
  RatingBar,
  StatusPill,
} from "./ui-bits";

export default function GameSpotlight({
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
    <motion.article
      layout
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.5, delay: Math.min(index * 0.05, 0.35), ease: [0.22, 1, 0.36, 1] }}
      onClick={onOpen}
      className="group relative cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-panel transition-all duration-300 hover:border-white/25"
    >
      {/* hero backdrop */}
      <div className="absolute inset-0">
        {game.heroUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={game.heroUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover opacity-35 transition-all duration-700 group-hover:scale-[1.03] group-hover:opacity-45"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-white/[0.04] to-transparent" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-void via-void/85 to-void/30" />
        <div className="absolute inset-x-0 bottom-0 h-1" style={{ background: statusColor }} />
      </div>

      <div className="relative flex gap-5 p-4 sm:gap-7 sm:p-7">
        {/* cover */}
        <div className="relative w-24 shrink-0 self-start overflow-hidden rounded-xl border border-white/20 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.9)] transition-transform duration-300 group-hover:-translate-y-1 sm:w-36">
          <div className="aspect-[3/4]">
            <CoverArt game={game} />
          </div>
        </div>

        {/* content */}
        <div className="min-w-0 flex-1 py-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <StatusPill status={game.status} size="sm" />
            {game.platform && <PlatformBadge label={game.platform} />}
            <span className="tabular font-mono text-[11px] text-white/45">
              {game.releaseYear ?? "TBA"}
            </span>
          </div>

          <h3 className="font-display mt-3 line-clamp-2 text-xl leading-tight font-bold text-white transition-colors group-hover:text-volt sm:text-3xl">
            {game.title}
          </h3>

          {game.summary && (
            <p className="mt-2 hidden max-w-2xl text-[13px] leading-relaxed text-white/55 sm:block lg:line-clamp-2">
              {game.summary}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
            {game.genres && game.genres.length > 0 && (
              <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] text-white/45 uppercase">
                <Layers size={11} />
                {game.genres.slice(0, 3).join(" · ")}
              </span>
            )}
            {game.developer && (
              <span className="hidden font-mono text-[10px] tracking-[0.16em] text-white/45 uppercase md:block">
                {game.developer}
              </span>
            )}
            {game.hoursPlayed ? (
              <span className="tabular flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] text-white/45 uppercase">
                <Clock3 size={11} />
                {game.hoursPlayed} hrs logged
              </span>
            ) : null}
          </div>
        </div>

        {/* right rail */}
        <div className="flex shrink-0 flex-col items-end justify-between py-1">
          <FavoriteButton
            active={game.favorite}
            onToggle={onToggleFavorite}
            className="h-8 w-8"
            size={15}
          />
          <div className="flex flex-col items-end gap-2">
            <CriticScore score={game.criticScore} />
            <RatingBar rating={game.rating} />
          </div>
        </div>
      </div>
    </motion.article>
  );
}
