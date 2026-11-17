"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Clock3, Undo2, ShoppingBag } from "lucide-react";

import type { CoOpGame } from "@/db/schema";
import { STATUS_META, platformTone } from "@/lib/constants";
import { CoverArt, FavoriteButton, PlatformBadge, RatingBar, StatusPill } from "./ui-bits";

export type CoOpView = "tile" | "list" | "compact";

export interface CoOpViewProps {
  games: CoOpGame[];
  isAdmin: boolean;
  busyIds: Record<number, boolean>;
  onOpen: (game: CoOpGame) => void;
  onMoveBucket: (game: CoOpGame, nextBought: boolean) => void;
  onToggleLoved: (game: CoOpGame) => void;
}

/* ================= Tile view — poster-style ================= */
export function CoOpTileView({
  games,
  isAdmin,
  busyIds,
  onOpen,
  onMoveBucket,
  onToggleLoved,
}: CoOpViewProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 sm:gap-4 2xl:grid-cols-5">
      <AnimatePresence mode="popLayout" initial={false}>
      {games.map((game) => {
        const busy = Boolean(busyIds[game.id]);
        const statusColor = STATUS_META[game.status]?.color ?? "#9a9aa6";
        return (
          <motion.article
            layout
            layoutId={`coop-tile-${game.id}`}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            key={game.id}
            className={`group relative flex flex-col rounded-2xl border p-2 pb-3 backdrop-blur transition-colors ${
              game.isBought
                ? "border-volt/15 bg-gradient-to-br from-volt/[0.05] to-panel-2 hover:border-volt/30"
                : "border-pink/15 bg-gradient-to-br from-pink/[0.07] to-panel-2 hover:border-pink/35"
            }`}
          >
            {/* cover */}
            <button
              onClick={() => onOpen(game)}
              aria-label={`Open ${game.title} details`}
              className="relative block aspect-[3/4] w-full overflow-hidden rounded-xl border border-white/10 bg-panel-2 text-left"
            >
              <div className="absolute inset-0 transition-transform duration-500 ease-out group-hover:scale-[1.05]">
                <CoverArt game={{ title: game.title, coverUrl: game.coverUrl }} />
              </div>
              {/* status strip */}
              <div
                className="absolute inset-x-0 bottom-0 h-1"
                style={{ background: statusColor }}
              />
              {/* year chip */}
              <span className="tabular absolute top-2 left-2 rounded-md border border-white/15 bg-black/55 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white/85 backdrop-blur-sm">
                {game.releaseYear ?? "TBA"}
              </span>
              {/* loved badge / toggle */}
              {isAdmin ? (
                <FavoriteButton
                  active={game.isLoved}
                  onToggle={() => onToggleLoved(game)}
                  className="absolute top-2 right-2 h-7 w-7 backdrop-blur-sm"
                  size={13}
                />
              ) : (
                game.isLoved && (
                  <span
                    className="absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-full border border-pink/40 bg-pink/20 text-pink backdrop-blur-sm"
                    title="Loved"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 21s-7.5-4.9-10-9.3C.4 8.4 2.9 5 6.6 5c2.2 0 3.9 1.1 5.4 3 1.5-1.9 3.2-3 5.4-3 3.7 0 6.2 3.4 4.6 6.7C19.5 16.1 12 21 12 21Z" />
                    </svg>
                  </span>
                )
              )}
              {/* status pill over the art */}
              <span className="absolute bottom-2.5 left-2">
                <StatusPill status={game.status} size="sm" />
              </span>
            </button>

            {/* meta */}
            <div className="mt-2 flex min-w-0 flex-1 flex-col px-1">
              <button
                onClick={() => onOpen(game)}
                className="text-left text-[13px] leading-snug font-semibold text-ink underline-offset-2 hover:underline"
              >
                <span className="line-clamp-1">{game.title}</span>
              </button>

              <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2">
                {game.platform ? (
                  <PlatformBadge label={game.platform} />
                ) : (
                  <span className="font-mono text-[9px] tracking-[0.14em] text-white/30 uppercase">
                    No platform yet
                  </span>
                )}
                {game.rating !== null && (
                  <span className="tabular shrink-0 font-mono text-[11px] font-bold text-pink">
                    {game.rating}
                    <span className="text-white/35">/10</span>
                  </span>
                )}
              </div>

              <div className="mt-1.5 flex items-center justify-between gap-2 font-mono text-[9px] text-white/40">
                <span className="inline-flex items-center gap-1">
                  <Clock3 size={10} />
                  <span className="tabular">{game.hoursPlayed ?? 0}h</span>
                </span>
                {game.coopTag && (
                  <span className="truncate text-violet/80">{game.coopTag}</span>
                )}
              </div>

              {/* one-click bucket move */}
              {isAdmin && (
                <button
                  onClick={() => onMoveBucket(game, !game.isBought)}
                  disabled={busy}
                  className={`mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 font-mono text-[8px] font-bold tracking-[0.14em] uppercase transition-all disabled:opacity-50 ${
                    game.isBought
                      ? "border border-white/10 text-white/50 hover:border-white/25 hover:text-white"
                      : "bg-pink text-void shadow-[0_0_16px_rgba(255,77,141,0.35)] hover:shadow-[0_0_22px_rgba(255,77,141,0.5)]"
                  }`}
                >
                  {game.isBought ? <Undo2 size={11} /> : <ShoppingBag size={11} strokeWidth={2.5} />}
                  {game.isBought ? "Back to wishlist" : "Move to Bought"}
                </button>
              )}
            </div>
          </motion.article>
        );
      })}
      </AnimatePresence>
    </div>
  );
}

/* ================= List view — sleek rows ================= */
export function CoOpListView({
  games,
  isAdmin,
  busyIds,
  onOpen,
  onMoveBucket,
  onToggleLoved,
}: CoOpViewProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <AnimatePresence mode="popLayout" initial={false}>
      {games.map((game) => {
        const busy = Boolean(busyIds[game.id]);
        return (
          <motion.div
            layout
            layoutId={`coop-list-${game.id}`}
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.25 }}
            key={game.id}
            onClick={() => onOpen(game)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(game);
              }
            }}
            className="group grid cursor-pointer grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-transparent px-2 py-2 transition-all hover:border-white/10 hover:bg-white/[0.04] sm:grid-cols-[48px_minmax(0,1.6fr)_minmax(0,0.9fr)_auto_auto_auto_auto] sm:gap-4 sm:px-3"
          >
            {/* thumbnail */}
            <div className="h-16 w-11 shrink-0 overflow-hidden rounded-md border border-white/10 bg-panel-2 sm:h-[4.5rem] sm:w-12">
              <CoverArt game={{ title: game.title, coverUrl: game.coverUrl }} />
            </div>

            {/* title + note preview */}
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-ink transition-colors group-hover:text-pink">
                {game.title}
              </p>
              <p className="tabular mt-0.5 truncate font-mono text-[9px] tracking-[0.12em] text-white/40 uppercase">
                {game.releaseYear ?? "TBA"}
                {game.coopTag && <> · <span className="text-violet/80">{game.coopTag}</span></>}
              </p>
              {game.notes && (
                <p className="mt-0.5 truncate text-[10px] leading-snug text-pink/60 italic">
                  “{game.notes}”
                </p>
              )}
            </div>

            {/* platform */}
            <div className="hidden min-w-0 items-center gap-1.5 font-mono text-[10px] tracking-[0.1em] text-white/60 uppercase sm:flex">
              {game.platform ? (
                <>
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: platformTone(game.platform) }}
                  />
                  <span className="truncate">{game.platform}</span>
                </>
              ) : (
                <span className="text-white/25">—</span>
              )}
            </div>

            {/* status */}
            <div className="hidden sm:block">
              <StatusPill status={game.status} size="sm" />
            </div>

            {/* rating + hours */}
            <div className="hidden flex-col items-end gap-1 sm:flex">
              <RatingBar rating={game.rating} color="#ff4d8d" />
              <span className="tabular inline-flex items-center gap-1 font-mono text-[9px] text-white/40">
                <Clock3 size={9} />
                {game.hoursPlayed ?? 0}h
              </span>
            </div>

            {/* quick actions */}
            <div className="flex items-center gap-1.5">
              {isAdmin ? (
                <>
                  <FavoriteButton
                    active={game.isLoved}
                    onToggle={() => onToggleLoved(game)}
                    className="h-8 w-8"
                    size={13}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveBucket(game, !game.isBought);
                    }}
                    disabled={busy}
                    aria-label={game.isBought ? "Move back to wishlist" : "Move to Bought"}
                    title={game.isBought ? "Back to wishlist" : "Move to Bought"}
                    className={`grid h-8 w-8 place-items-center rounded-full border backdrop-blur transition-all disabled:opacity-50 ${
                      game.isBought
                        ? "border-white/10 text-white/45 hover:border-white/30 hover:text-white"
                        : "border-pink/50 bg-pink/15 text-pink hover:bg-pink hover:text-void"
                    }`}
                  >
                    {game.isBought ? <Undo2 size={13} /> : <ShoppingBag size={13} strokeWidth={2.4} />}
                  </button>
                </>
              ) : (
                game.isLoved && (
                  <span className="grid h-8 w-8 place-items-center text-pink" title="Loved">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 21s-7.5-4.9-10-9.3C.4 8.4 2.9 5 6.6 5c2.2 0 3.9 1.1 5.4 3 1.5-1.9 3.2-3 5.4-3 3.7 0 6.2 3.4 4.6 6.7C19.5 16.1 12 21 12 21Z" />
                    </svg>
                  </span>
                )
              )}
            </div>
          </motion.div>
        );
      })}
      </AnimatePresence>
    </div>
  );
}

/* ================= Compact view — dense shelf ================= */
export function CoOpCompactView({ games, onOpen }: CoOpViewProps) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
      <AnimatePresence mode="popLayout" initial={false}>
      {games.map((game) => {
        const statusColor = STATUS_META[game.status]?.color ?? "#9a9aa6";
        return (
          <motion.button
            layout
            layoutId={`coop-compact-${game.id}`}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.22 }}
            key={game.id}
            onClick={() => onOpen(game)}
            aria-label={`Open ${game.title}`}
            title={game.title}
            className="group relative block aspect-[3/4] overflow-hidden rounded-lg border border-white/10 bg-panel-2 text-left transition-all hover:border-pink/40 hover:shadow-[0_0_18px_rgba(255,77,141,0.25)]"
          >
            <CoverArt game={{ title: game.title, coverUrl: game.coverUrl }} />
            {/* status dot */}
            <span
              className="absolute top-1.5 left-1.5 h-2.5 w-2.5 rounded-full border border-black/60"
              style={{ background: statusColor }}
              title={game.status}
            />
            {/* loved indicator */}
            {game.isLoved && (
              <span className="absolute top-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/55 text-pink backdrop-blur-[2px]">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 21s-7.5-4.9-10-9.3C.4 8.4 2.9 5 6.6 5c2.2 0 3.9 1.1 5.4 3 1.5-1.9 3.2-3 5.4-3 3.7 0 6.2 3.4 4.6 6.7C19.5 16.1 12 21 12 21Z" />
                </svg>
              </span>
            )}
            {/* bottom title sliver */}
            <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/90 to-transparent px-1.5 pt-4 pb-1 text-[8px] font-medium text-white/80">
              {game.title}
            </span>
          </motion.button>
        );
      })}
      </AnimatePresence>

    </div>
  );
}
