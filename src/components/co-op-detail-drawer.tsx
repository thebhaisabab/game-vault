"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  CloudUpload,
  Gamepad2,
  Heart,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";

import type { CoOpGame } from "@/db/schema";
import {
  formatAdded,
  STATUS_META,
  STATUS_ORDER,
  platformTone,
} from "@/lib/constants";
import { COOP_TAGS, type CoOpTag, type GameStatus } from "@/lib/types";

export interface CoOpPatch {
  isBought?: boolean;
  status?: GameStatus;
  platform?: string | null;
  rating?: number | null;
  hoursPlayed?: number | null;
  isLoved?: boolean;
  notes?: string | null;
  coopTag?: CoOpTag | null;
}

/** The exact "Played On" pill list for the co-op vault. */
const PLAYED_ON = [
  "PC",
  "PS4",
  "PS5",
  "XBOX SERIES X|S",
  "XBOX ONE",
  "SWITCH",
  "SWITCH 2",
  "MAC",
  "LINUX",
  "PS3",
  "XBOX 360",
  "WII U",
  "GAMECUBE",
  "3DS",
  "IOS",
  "ANDROID",
  "OTHER",
] as const;

interface CoOpDetailDrawerProps {
  game: CoOpGame | null;
  onClose: () => void;
  onUpdate: (id: number, patch: CoOpPatch) => Promise<boolean>;
  onDelete: (id: number) => void;
}

export default function CoOpDetailDrawer(props: CoOpDetailDrawerProps) {
  // Remounting the body per game id lets useState initialize from props —
  // no setState-in-effect syncing needed.
  if (!props.game) return null;
  return <DrawerBody key={props.game.id} {...props} game={props.game} />;
}

function DrawerBody({
  game,
  onClose,
  onUpdate,
  onDelete,
}: CoOpDetailDrawerProps & { game: CoOpGame }) {
  const [notes, setNotes] = useState(game.notes ?? "");
  const [hours, setHours] = useState(
    game.hoursPlayed != null ? String(game.hoursPlayed) : "",
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const notesTimer = useRef<number | undefined>(undefined);
  const hoursTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    return () => {
      window.clearTimeout(notesTimer.current);
      window.clearTimeout(hoursTimer.current);
    };
  }, []);

  const save = async (patch: CoOpPatch) => {
    setSaveState("saving");
    const ok = await onUpdate(game.id, patch);
    setSaveState(ok ? "saved" : "idle");
  };

  return (
    <>
      {/* backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/65 backdrop-blur-[2px]"
      />
      <motion.aside
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        className="fixed top-0 right-0 z-50 flex h-dvh w-full max-w-[440px] flex-col border-l border-pink/15 bg-panel"
        role="dialog"
        aria-label={`${game.title} — co-op details`}
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
          {!game.heroUrl && (
            <div className="absolute inset-0 bg-gradient-to-br from-pink/25 via-panel-2 to-violet/25" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-panel via-panel/40 to-transparent" />
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <span
              className={`font-mono text-[10px] tracking-[0.14em] uppercase transition-colors ${
                saveState === "saving"
                  ? "text-amber"
                  : saveState === "saved"
                    ? "text-pink"
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
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {game.releaseYear && (
                <span className="tabular font-mono text-[11px] text-white/55">
                  {game.releaseYear}
                </span>
              )}
              <span className="inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.22em] text-pink/80 uppercase">
                <Gamepad2 size={10} />
                P1 &amp; P2
              </span>
              {game.coopTag && (
                <span className="inline-flex items-center rounded-full border border-violet/40 bg-violet/15 px-2 py-0.5 font-mono text-[8px] font-medium tracking-[0.16em] text-violet uppercase">
                  {game.coopTag}
                </span>
              )}
            </div>
            <h2 className="font-display text-2xl leading-tight font-bold text-white">
              {game.title}
            </h2>
          </div>
        </div>

        {/* body */}
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-6">
          {/* ownership bucket */}
          <section>
            <DrawerLabel>Ownership</DrawerLabel>
            <div
              className="mt-2.5 grid grid-cols-2 gap-1.5"
              role="group"
              aria-label="Ownership bucket"
            >
              <button
                onClick={() => save({ isBought: true })}
                aria-pressed={game.isBought}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 font-mono text-[10px] font-bold tracking-[0.1em] uppercase transition-all ${
                  game.isBought
                    ? "border-volt/60 bg-volt/12 text-volt shadow-[0_0_18px_rgba(200,255,62,0.18)]"
                    : "border-white/10 text-white/55 hover:border-white/25 hover:text-white"
                }`}
              >
                <ShoppingBag size={13} strokeWidth={2.4} />
                Already Bought
              </button>
              <button
                onClick={() => save({ isBought: false })}
                aria-pressed={!game.isBought}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 font-mono text-[10px] font-bold tracking-[0.1em] uppercase transition-all ${
                  !game.isBought
                    ? "border-pink/60 bg-pink/12 text-pink shadow-[0_0_18px_rgba(255,77,141,0.22)]"
                    : "border-white/10 text-white/55 hover:border-white/25 hover:text-white"
                }`}
              >
                <Heart size={13} strokeWidth={2.4} fill={!game.isBought ? "currentColor" : "none"} />
                Wishlist
              </button>
            </div>
          </section>

          {/* co-op mode tag */}
          <section>
            <DrawerLabel>Co-op mode</DrawerLabel>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {COOP_TAGS.map((tag) => {
                const active = game.coopTag === tag;
                return (
                  <button
                    key={tag}
                    onClick={() => save({ coopTag: active ? null : tag })}
                    aria-pressed={active}
                    className={`rounded-full border px-2.5 py-1.5 font-mono text-[9px] font-medium tracking-[0.12em] uppercase transition-all ${
                      active
                        ? "border-violet/60 bg-violet/20 text-violet shadow-[0_0_16px_rgba(157,123,255,0.35)]"
                        : "border-white/10 text-white/55 hover:border-white/25 hover:text-white"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </section>

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
                    aria-pressed={active}
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

          {/* played on */}
          <section>
            <DrawerLabel>Played on</DrawerLabel>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {PLAYED_ON.map((p) => {
                const active = game.platform === p;
                return (
                  <button
                    key={p}
                    onClick={() => save({ platform: active ? null : p })}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1.5 font-mono text-[9px] font-medium tracking-[0.08em] uppercase transition-all ${
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
                    aria-pressed={active}
                    aria-label={`Rate ${n} out of 10`}
                    className={`tabular rounded-md border py-2 font-mono text-[11px] font-semibold transition-all ${
                      active
                        ? "border-pink bg-pink text-void"
                        : filled
                          ? "border-pink/40 bg-pink/10 text-pink"
                          : "border-white/10 text-white/45 hover:border-white/30 hover:text-white"
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </section>

          {/* hours + loved */}
          <section className="grid grid-cols-2 gap-4">
            <div>
              <DrawerLabel>Hours played</DrawerLabel>
              <label className="mt-2.5 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 transition-colors focus-within:border-pink/60">
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
                onClick={() => save({ isLoved: !game.isLoved })}
                aria-pressed={game.isLoved}
                className={`mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2.5 font-mono text-[11px] font-semibold tracking-[0.08em] uppercase transition-all ${
                  game.isLoved
                    ? "border-pink/50 bg-pink/10 text-pink shadow-[0_0_18px_rgba(255,77,141,0.25)]"
                    : "border-white/10 text-white/55 hover:border-white/25 hover:text-white"
                }`}
              >
                <Heart size={14} fill={game.isLoved ? "currentColor" : "none"} />
                {game.isLoved ? "Loved" : "Mark loved"}
              </button>
            </div>
          </section>

          {/* notes */}
          <section>
            <DrawerLabel>Notes · for the two of you</DrawerLabel>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                window.clearTimeout(notesTimer.current);
                notesTimer.current = window.setTimeout(() => {
                  save({ notes: e.target.value === "" ? null : e.target.value });
                }, 800);
              }}
              rows={4}
              placeholder="For weekend date night… whose idea was this anyway, ending we saw, snacks required."
              className="mt-2.5 w-full resize-none rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm leading-relaxed text-ink placeholder:text-white/25 focus:border-pink/60 focus:outline-none"
            />
          </section>
        </div>

        {/* footer */}
        <div className="flex items-center justify-between border-t border-white/10 px-5 py-4">
          <span className="font-mono text-[10px] tracking-[0.1em] text-white/35 uppercase">
            added {formatAdded(game.createdAt)}
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
