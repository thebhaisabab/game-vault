"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, CloudUpload, Heart, Trash2, X } from "lucide-react";
import type { LibraryGame } from "@/db/schema";
import {
  formatAdded,
  PLATFORM_SUGGESTIONS,
  STATUS_META,
  STATUS_ORDER,
  platformTone,
} from "@/lib/constants";
import type { GameStatus } from "@/lib/types";
import { CriticScore } from "./ui-bits";

export interface GamePatch {
  status?: GameStatus;
  rating?: number | null;
  hoursPlayed?: number | null;
  platform?: string | null;
  notes?: string | null;
  favorite?: boolean;
}

export default function DetailDrawer({
  game,
  onClose,
  onUpdate,
  onDelete,
}: {
  game: LibraryGame | null;
  onClose: () => void;
  onUpdate: (id: number, patch: GamePatch) => Promise<boolean>;
  onDelete: (id: number) => void;
}) {
  const [notes, setNotes] = useState("");
  const [hours, setHours] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const notesTimer = useRef<number | undefined>(undefined);
  const hoursTimer = useRef<number | undefined>(undefined);

  const gameId = game?.id;
  useEffect(() => {
    setNotes(game?.notes ?? "");
    setHours(game?.hoursPlayed != null ? String(game.hoursPlayed) : "");
    setSaveState("idle");
    setConfirmDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  useEffect(() => {
    if (!game) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [game, onClose]);

  useEffect(() => {
    return () => {
      window.clearTimeout(notesTimer.current);
      window.clearTimeout(hoursTimer.current);
    };
  }, []);

  if (!game) return null;

  const save = async (patch: GamePatch) => {
    setSaveState("saving");
    const ok = await onUpdate(game.id, patch);
    setSaveState(ok ? "saved" : "idle");
  };

  const platformChoices = [
    ...new Set([
      ...(game.platforms ?? []),
      ...(game.platform ? [game.platform] : []),
      ...PLATFORM_SUGGESTIONS,
    ]),
  ].slice(0, 18);

  return (
    <>
      {/* backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]"
      />
      <motion.aside
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        className="fixed top-0 right-0 z-50 flex h-dvh w-full max-w-[440px] flex-col border-l border-white/10 bg-panel"
        role="dialog"
        aria-label={`${game.title} details`}
      >
        {/* hero */}
        <div className="relative h-44 shrink-0 overflow-hidden">
          {game.heroUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={game.heroUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-panel via-panel/40 to-transparent" />
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <span
              className={`font-mono text-[10px] tracking-[0.14em] uppercase transition-colors ${
                saveState === "saving"
                  ? "text-amber"
                  : saveState === "saved"
                    ? "text-volt"
                    : "text-white/30"
              }`}
            >
              {saveState === "saving" ? (
                <span className="flex items-center gap-1.5">
                  <CloudUpload size={11} /> saving
                </span>
              ) : saveState === "saved" ? (
                <span className="flex items-center gap-1.5">
                  <Check size={11} /> synced
                </span>
              ) : (
                "edits sync instantly"
              )}
            </span>
            <button
              onClick={onClose}
              aria-label="Close details"
              className="grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-black/50 text-white/70 backdrop-blur transition-colors hover:text-white"
            >
              <X size={15} />
            </button>
          </div>

          <div className="absolute right-5 bottom-3 left-5">
            <div className="mb-2 flex items-center gap-2">
              {game.releaseYear && (
                <span className="tabular font-mono text-[11px] text-white/55">
                  {game.releaseYear}
                </span>
              )}
              {game.developer && (
                <span className="truncate font-mono text-[11px] text-white/55">
                  {game.developer}
                </span>
              )}
              <CriticScore score={game.criticScore} />
            </div>
            <h2 className="font-display text-2xl leading-tight font-bold text-white">
              {game.title}
            </h2>
            {game.genres && game.genres.length > 0 && (
              <p className="mt-1 truncate font-mono text-[10px] tracking-[0.16em] text-white/45 uppercase">
                {game.genres.join(" · ")}
              </p>
            )}
          </div>
        </div>

        {/* body */}
        <div className="flex-1 space-y-7 overflow-y-auto px-5 py-6">
          {/* status */}
          <section>
            <DrawerLabel>Status</DrawerLabel>
            <div className="mt-2.5 grid grid-cols-3 gap-1.5">
              {STATUS_ORDER.map((s) => {
                const meta = STATUS_META[s];
                const active = game.status === s;
                return (
                  <button
                    key={s}
                    onClick={() => save({ status: s })}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 font-mono text-[10px] font-semibold tracking-[0.08em] uppercase transition-all ${
                      active ? "font-bold" : "text-white/55 hover:border-white/25 hover:text-white"
                    }`}
                    style={
                      active
                        ? {
                            borderColor: `${meta.color}70`,
                            background: `${meta.color}15`,
                            color: meta.color,
                          }
                        : { borderColor: "rgba(255,255,255,0.1)" }
                    }
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* platform */}
          <section>
            <DrawerLabel>Played on</DrawerLabel>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {platformChoices.map((p) => {
                const active = game.platform === p;
                return (
                  <button
                    key={p}
                    onClick={() => save({ platform: active ? null : p })}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 font-mono text-[10px] font-medium tracking-[0.08em] uppercase transition-all ${
                      active
                        ? "border-white bg-white text-void"
                        : "border-white/10 text-white/60 hover:border-white/30 hover:text-white"
                    }`}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: active ? "#070709" : platformTone(p) }}
                    />
                    {p}
                  </button>
                );
              })}
            </div>
          </section>

          {/* rating */}
          <section>
            <div className="flex items-center justify-between">
              <DrawerLabel>Your rating</DrawerLabel>
              {game.rating !== null && (
                <button
                  onClick={() => save({ rating: null })}
                  className="font-mono text-[10px] tracking-[0.1em] text-white/40 uppercase hover:text-white"
                >
                  clear
                </button>
              )}
            </div>
            <div className="mt-2.5 grid grid-cols-10 gap-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
                const active = game.rating === n;
                const filled = game.rating !== null && n <= game.rating;
                return (
                  <button
                    key={n}
                    onClick={() => save({ rating: active ? null : n })}
                    className={`tabular rounded-md border py-2 font-mono text-[11px] font-semibold transition-all ${
                      active
                        ? "border-volt bg-volt text-void"
                        : filled
                          ? "border-volt/40 bg-volt/10 text-volt"
                          : "border-white/10 text-white/45 hover:border-white/30 hover:text-white"
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </section>

          {/* hours + favorite */}
          <section className="grid grid-cols-2 gap-4">
            <div>
              <DrawerLabel>Hours played</DrawerLabel>
              <label className="mt-2.5 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 transition-colors focus-within:border-volt/60">
                <input
                  type="number"
                  min={0}
                  value={hours}
                  onChange={(e) => {
                    const v = e.target.value;
                    setHours(v);
                    window.clearTimeout(hoursTimer.current);
                    hoursTimer.current = window.setTimeout(() => {
                      save({ hoursPlayed: v === "" ? null : Number(v) });
                    }, 650);
                  }}
                  placeholder="0"
                  className="tabular w-full bg-transparent font-mono text-sm text-ink placeholder:text-white/25 focus:outline-none"
                />
                <span className="font-mono text-[10px] text-white/35 uppercase">hrs</span>
              </label>
            </div>
            <div>
              <DrawerLabel>Favorite</DrawerLabel>
              <button
                onClick={() => save({ favorite: !game.favorite })}
                className={`mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2.5 font-mono text-[11px] font-semibold tracking-[0.08em] uppercase transition-all ${
                  game.favorite
                    ? "border-pink/50 bg-pink/10 text-pink"
                    : "border-white/10 text-white/55 hover:border-white/25 hover:text-white"
                }`}
              >
                <Heart size={14} fill={game.favorite ? "currentColor" : "none"} />
                {game.favorite ? "Loved" : "Mark loved"}
              </button>
            </div>
          </section>

          {/* notes */}
          <section>
            <DrawerLabel>Notes</DrawerLabel>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                window.clearTimeout(notesTimer.current);
                notesTimer.current = window.setTimeout(() => {
                  save({ notes: e.target.value });
                }, 800);
              }}
              rows={4}
              placeholder="Controller of choice, endings seen, backlog shame…"
              className="mt-2.5 w-full resize-none rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm leading-relaxed text-ink placeholder:text-white/25 focus:border-volt/60 focus:outline-none"
            />
          </section>

          {game.summary && (
            <section>
              <DrawerLabel>About</DrawerLabel>
              <p className="mt-2.5 text-[13px] leading-relaxed text-white/60">{game.summary}</p>
            </section>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between border-t border-white/10 px-5 py-4">
          <span className="font-mono text-[10px] tracking-[0.1em] text-white/35 uppercase">
            added {formatAdded(game.addedAt)}
          </span>
          <button
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                window.setTimeout(() => setConfirmDelete(false), 2600);
                return;
              }
              onDelete(game.id);
            }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 font-mono text-[10px] font-semibold tracking-[0.1em] uppercase transition-all ${
              confirmDelete
                ? "border-rose bg-rose text-void"
                : "border-white/10 text-white/50 hover:border-rose/50 hover:text-rose"
            }`}
          >
            <Trash2 size={12} />
            {confirmDelete ? "Sure?" : "Remove"}
          </button>
        </div>
      </motion.aside>
    </>
  );
}

function DrawerLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] font-semibold tracking-[0.26em] text-white/40 uppercase">
      {children}
    </p>
  );
}
