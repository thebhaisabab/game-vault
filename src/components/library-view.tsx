"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Ghost, Plus } from "lucide-react";
import type { LibraryGame } from "@/db/schema";
import type { LibraryView } from "@/lib/constants";
import GameCard from "./game-card";
import GameRow from "./game-row";
import GameSpotlight from "./game-spotlight";

export default function LibraryView({
  view,
  games,
  isFiltered,
  onOpen,
  onToggleFavorite,
  onAdd,
}: {
  view: LibraryView;
  games: LibraryGame[];
  isFiltered: boolean;
  onOpen: (g: LibraryGame) => void;
  onToggleFavorite: (g: LibraryGame) => void;
  onAdd: () => void;
}) {
  if (games.length === 0) {
    return (
      <motion.div
        key="empty"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative mx-auto my-16 max-w-xl overflow-hidden rounded-3xl border border-white/10"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/vault-void.jpg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-45"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-void via-void/60 to-transparent" />
        <div className="relative flex flex-col items-center px-8 py-20 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl border border-volt/30 bg-volt/10 text-volt">
            <Ghost size={24} />
          </div>
          <h2 className="font-display mt-6 text-2xl font-bold">
            {isFiltered ? "Nothing matches" : "The vault is empty"}
          </h2>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/55">
            {isFiltered
              ? "No games match these filters yet. Try widening the net."
              : "Search any game ever released — PlayStation, Xbox, Nintendo or PC — and start building your collection."}
          </p>
          <button
            onClick={onAdd}
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-volt px-5 py-2.5 font-mono text-xs font-bold tracking-[0.14em] text-void uppercase transition-transform hover:scale-[1.03]"
          >
            <Plus size={14} strokeWidth={2.6} />
            {isFiltered ? "Add a game" : "Add your first game"}
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={view}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        className={
          view === "grid"
            ? "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
            : view === "list"
              ? "flex flex-col divide-y divide-white/[0.04]"
              : "flex flex-col gap-5"
        }
      >
        {view === "grid" &&
          games.map((g, i) => (
            <GameCard
              key={g.id}
              game={g}
              index={i}
              onOpen={() => onOpen(g)}
              onToggleFavorite={() => onToggleFavorite(g)}
            />
          ))}
        {view === "list" &&
          games.map((g, i) => (
            <GameRow
              key={g.id}
              game={g}
              index={i}
              onOpen={() => onOpen(g)}
              onToggleFavorite={() => onToggleFavorite(g)}
            />
          ))}
        {view === "showcase" &&
          games.map((g, i) => (
            <GameSpotlight
              key={g.id}
              game={g}
              index={i}
              onOpen={() => onOpen(g)}
              onToggleFavorite={() => onToggleFavorite(g)}
            />
          ))}
      </motion.div>
    </AnimatePresence>
  );
}
