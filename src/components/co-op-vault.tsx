"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AnimatePresence, LayoutGroup } from "framer-motion";
import {
  ArrowLeft,
  Gamepad2,
  Grid3x3,
  Heart,
  LayoutGrid,
  List,
  Lock,
  Plus,
  ShoppingBag,
  Sparkles,
  Users,
  WifiOff,
} from "lucide-react";

import type { CoOpGame } from "@/db/schema";
import Toasts, { type Toast } from "./toasts";
import CoOpAddModal, { type CoOpAddPayload } from "./co-op-add-modal";
import CoOpDetailDrawer, { type CoOpPatch } from "./co-op-detail-drawer";
import { CoOpCompactView, CoOpListView, CoOpTileView, type CoOpView } from "./co-op-views";

type Section = "bought" | "wishlist";

/* ---------------- view preference (localStorage, default: tile) --------- */
const COOP_VIEW_KEY = "gv-coop-view";
const viewListeners = new Set<() => void>();
const viewStore = {
  get(): CoOpView {
    try {
      const v = window.localStorage.getItem(COOP_VIEW_KEY);
      return v === "list" || v === "compact" ? v : "tile";
    } catch {
      return "tile";
    }
  },
  set(v: CoOpView) {
    try {
      window.localStorage.setItem(COOP_VIEW_KEY, v);
    } catch {
      /* private mode */
    }
    viewListeners.forEach((l) => l());
  },
  subscribe(cb: () => void) {
    viewListeners.add(cb);
    return () => {
      viewListeners.delete(cb);
    };
  },
};

const VIEW_OPTIONS: { id: CoOpView; label: string; icon: typeof LayoutGrid }[] = [
  { id: "tile", label: "Tile view", icon: LayoutGrid },
  { id: "list", label: "List view", icon: List },
  { id: "compact", label: "Compact grid", icon: Grid3x3 },
];

export default function CoOpVault({
  initialGames,
  initialDbOk,
}: {
  initialGames: CoOpGame[];
  initialDbOk: boolean;
}) {
  const [games, setGames] = useState<CoOpGame[]>(initialGames);
  const [dbOk, setDbOk] = useState(initialDbOk);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busyIds, setBusyIds] = useState<Record<number, boolean>>({});
  const view = useSyncExternalStore(viewStore.subscribe, viewStore.get, () => "tile");

  // ---------- admin verification (mirrors the main vault pattern) ----------
  // Persist the ?admin=<secret> grant once, then derive admin state with
  // useSyncExternalStore: ?admin= works on the very first render, and
  // sessionStorage keeps it across plain revisits.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const secret = params.get("admin");
      const expectedSecret = process.env.NEXT_PUBLIC_ADMIN_SECRET;
      if (secret && expectedSecret && secret === expectedSecret) {
        sessionStorage.setItem("gv_admin", "true");
      }
    } catch {
      /* private mode fallback */
    }
  }, []);
  const isAdmin = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const secret = params.get("admin");
        const expectedSecret = process.env.NEXT_PUBLIC_ADMIN_SECRET;
        if (secret && expectedSecret && secret === expectedSecret) return true;
        return sessionStorage.getItem("gv_admin") === "true";
      } catch {
        return false;
      }
    },
    () => false,
  );

  const gamesRef = useRef(games);
  useEffect(() => {
    gamesRef.current = games;
  }, [games]);

  const adminQuery = useMemo(() => {
    const secret = process.env.NEXT_PUBLIC_ADMIN_SECRET;
    return secret ? `?admin=${encodeURIComponent(secret)}` : "";
  }, []);

  // ---------- toasts ----------
  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
    window.setTimeout(
      () => setToasts((ts) => ts.filter((x) => x.id !== id)),
      t.kind === "err" ? 6500 : 4200,
    );
  }, []);

  // ---------- derived data ----------
  const bought = useMemo(
    () =>
      games
        .filter((g) => g.isBought)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [games],
  );
  const wishlist = useMemo(
    () =>
      games
        .filter((g) => !g.isBought)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [games],
  );

  const selectedGame = useMemo(
    () => (selectedId !== null ? (games.find((g) => g.id === selectedId) ?? null) : null),
    [games, selectedId],
  );

  const inCollection = useCallback(
    (externalId: string | null) =>
      Boolean(externalId) && games.some((g) => g.externalId === externalId),
    [games],
  );

  // ---------- mutations ----------
  const setBusy = (id: number, busy: boolean) =>
    setBusyIds((m) => ({ ...m, [id]: busy }));

  const addGame = useCallback(
    async (payload: CoOpAddPayload): Promise<"added" | "error"> => {
      try {
        const res = await fetch(`/api/co-op${adminQuery}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.status === 401) {
          pushToast({
            kind: "err",
            title: "Player 1 only",
            detail: "Admin key required to add games.",
          });
          return "error";
        }
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { game: CoOpGame };
        setGames((gs) => [data.game, ...gs]);
        setDbOk(true);
        pushToast({
          kind: "ok",
          title: data.game.isBought
            ? "On the shelf — one for the two of you 🎮"
            : "Pinned to the co-op wishlist 💗",
          detail: data.game.title,
        });
        return "added";
      } catch {
        pushToast({
          kind: "err",
          title: "Could not add it right now",
          detail: "Database unreachable — try again in a moment.",
        });
        return "error";
      }
    },
    [adminQuery, pushToast],
  );

  /** Drawer/quick-action patch — optimistic with rollback. Returns success. */
  const updateGame = useCallback(
    async (id: number, patch: CoOpPatch): Promise<boolean> => {
      if (!isAdmin) return false;
      const snapshot = gamesRef.current;
      setGames((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g)));
      setBusy(id, true);
      try {
        const res = await fetch(`/api/co-op${adminQuery}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, ...patch }),
        });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { game: CoOpGame };
        setGames((gs) => gs.map((g) => (g.id === id ? data.game : g)));
        if (typeof patch.isBought === "boolean") {
          pushToast(
            patch.isBought
              ? { kind: "ok", title: "It's ours now 🎉", detail: data.game.title }
              : { kind: "info", title: "Back to the wishlist", detail: data.game.title },
          );
        }
        return true;
      } catch {
        setGames(snapshot);
        pushToast({
          kind: "err",
          title: "Sync failed",
          detail: "Database unreachable — the change was reverted.",
        });
        return false;
      } finally {
        setBusy(id, false);
      }
    },
    [adminQuery, isAdmin, pushToast],
  );

  const moveBucket = useCallback(
    (game: CoOpGame, nextBought: boolean) => {
      void updateGame(game.id, { isBought: nextBought });
    },
    [updateGame],
  );

  const toggleLoved = useCallback(
    (game: CoOpGame) => {
      void updateGame(game.id, { isLoved: !game.isLoved });
    },
    [updateGame],
  );

  const openGame = useCallback(
    (game: CoOpGame) => {
      if (!isAdmin) {
        pushToast({
          kind: "info",
          title: "Player 1 only",
          detail: "You're here for the romance — edits are Player 1's job.",
        });
        return;
      }
      setSelectedId(game.id);
    },
    [isAdmin, pushToast],
  );

  const removeGame = useCallback(
    async (id: number) => {
      if (!isAdmin) return;
      const game = gamesRef.current.find((g) => g.id === id);
      const snapshot = gamesRef.current;
      setGames((gs) => gs.filter((g) => g.id !== id));
      setSelectedId(null);
      try {
        const sep = adminQuery ? "&" : "?";
        const res = await fetch(`/api/co-op${adminQuery}${sep}id=${id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error();
        pushToast({
          kind: "info",
          title: "Removed from the co-op vault",
          detail: game?.title,
        });
      } catch {
        setGames(snapshot);
        pushToast({
          kind: "err",
          title: "Could not remove it",
          detail: "Database unreachable — the game was restored.",
        });
      }
    },
    [adminQuery, isAdmin, pushToast],
  );

  const renderView = (list: CoOpGame[]) => {
    const shared = {
      games: list,
      isAdmin,
      busyIds,
      onOpen: openGame,
      onMoveBucket: moveBucket,
      onToggleLoved: toggleLoved,
    };
    switch (view) {
      case "list":
        return <CoOpListView {...shared} />;
      case "compact":
        return <CoOpCompactView {...shared} />;
      case "tile":
      default:
        return <CoOpTileView {...shared} />;
    }
  };

  return (
    <div className="relative min-h-screen overflow-x-clip">
      {/* ---------- warm romantic backdrop over the obsidian stage ---------- */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-void" />
        <div className="absolute -top-40 left-1/2 h-[34rem] w-[64rem] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,77,141,0.22),transparent_65%)] blur-2xl" />
        <div className="absolute top-1/4 -left-40 h-[30rem] w-[30rem] rounded-full bg-[radial-gradient(circle,rgba(157,123,255,0.18),transparent_70%)] blur-2xl" />
        <div className="absolute right-[-10rem] bottom-[-8rem] h-[32rem] w-[32rem] rounded-full bg-[radial-gradient(circle,rgba(255,77,141,0.14),transparent_70%)] blur-2xl" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:44px_44px]" />
      </div>

      {/* ---------- top bar ---------- */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-void/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="group inline-flex items-center gap-2 rounded-full border border-white/10 py-1.5 pr-4 pl-2 font-mono text-[10px] font-medium tracking-[0.18em] text-white/60 uppercase transition-all hover:border-pink/40 hover:text-pink"
          >
            <ArrowLeft size={13} className="transition-transform group-hover:-translate-x-0.5" />
            The Vault
          </Link>

          <div className="flex items-center gap-2">
            <span className="hidden font-mono text-[9px] tracking-[0.3em] text-white/30 uppercase sm:block">
              Sabab Plays
            </span>
            <span className="grid h-7 w-7 place-items-center rounded-md border border-pink/30 bg-pink/10">
              <Heart size={13} className="text-pink" fill="currentColor" />
            </span>
          </div>

          {isAdmin ? (
            <button
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-pink px-4 py-2 font-mono text-[10px] font-bold tracking-[0.18em] text-void uppercase shadow-[0_0_24px_rgba(255,77,141,0.4)] transition-all hover:bg-[#ff6ba0] hover:shadow-[0_0_32px_rgba(255,77,141,0.55)]"
            >
              <Plus size={13} strokeWidth={2.8} />
              <span className="hidden sm:inline">Add Co-Op Game</span>
              <span className="sm:hidden">Add</span>
            </button>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-2 font-mono text-[9px] tracking-[0.16em] text-white/35 uppercase"
              title="Viewing together — adding is Player 1's job"
            >
              <Lock size={11} />
              View only
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        {/* ---------- DB offline banner ---------- */}
        {!dbOk && (
          <div
            role="alert"
            className="mt-4 flex items-center gap-3 rounded-xl border border-rose/30 bg-rose/10 px-4 py-3 text-sm text-rose"
          >
            <WifiOff size={16} className="shrink-0" />
            <p>
              <span className="font-semibold">The co-op shelf can&apos;t be reached.</span>{" "}
              The database didn&apos;t answer — showing whatever we had. Try again in a moment.
            </p>
          </div>
        )}

        {/* ================= banner ================= */}
        <section className="relative mt-6 overflow-hidden rounded-3xl border border-pink/20 bg-gradient-to-br from-[#1a0a12] via-panel to-[#150e21] p-6 shadow-[0_40px_80px_-40px_rgba(255,77,141,0.35)] sm:p-10">
          <div
            aria-hidden="true"
            className="coop-banner-ring pointer-events-none absolute inset-0 rounded-3xl border border-pink/25"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 right-[-4rem] h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(255,77,141,0.3),transparent_70%)] blur-2xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-28 left-[-4rem] h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(157,123,255,0.28),transparent_70%)] blur-2xl"
          />

          <p className="relative flex flex-wrap items-center gap-2 font-mono text-[9px] font-medium tracking-[0.32em] text-pink/90 uppercase sm:text-[10px]">
            <Gamepad2 size={13} />
            Co-Op Mode // Player 1 &amp; Player 2
            <Heart size={11} fill="currentColor" className="coop-heart text-pink" />
          </p>

          <h1 className="relative font-display mt-4 text-[clamp(2.4rem,8vw,4.6rem)] leading-[0.95] font-extrabold tracking-tight">
            <span className="block text-ink">THE&nbsp;CO-OP</span>
            <span className="block bg-gradient-to-r from-pink via-[#ff7ab0] to-violet bg-clip-text text-transparent drop-shadow-[0_0_25px_rgba(255,77,141,0.35)]">
              VAULT.
            </span>
          </h1>

          <p className="relative mt-4 max-w-xl text-sm leading-relaxed text-white/60 sm:text-base">
            Every game we promised to play together — the ones already on the
            shelf and the ones still living on the wishlist. One couch, two
            controllers, zero mercy.{" "}
            <span className="text-pink/90">Player 2 always wins. Eventually.</span>
          </p>

          {/* stats */}
          <div className="relative mt-6 flex flex-wrap items-stretch gap-3 sm:gap-4">
            <div className="rounded-2xl border border-white/8 bg-black/40 px-4 py-3 backdrop-blur sm:px-6">
              <p className="font-mono text-[8px] tracking-[0.28em] text-white/40 uppercase">
                On the shelf
              </p>
              <p className="font-display mt-1 text-2xl font-extrabold text-volt tabular sm:text-3xl">
                {String(bought.length).padStart(2, "0")}
              </p>
            </div>
            <div className="rounded-2xl border border-white/8 bg-black/40 px-4 py-3 backdrop-blur sm:px-6">
              <p className="font-mono text-[8px] tracking-[0.28em] text-white/40 uppercase">
                Wishlist
              </p>
              <p className="font-display mt-1 text-2xl font-extrabold text-pink tabular sm:text-3xl">
                {String(wishlist.length).padStart(2, "0")}
              </p>
            </div>
            <div className="rounded-2xl border border-white/8 bg-black/40 px-4 py-3 backdrop-blur sm:px-6">
              <p className="font-mono text-[8px] tracking-[0.28em] text-white/40 uppercase">
                Together
              </p>
              <p className="font-display mt-1 text-2xl font-extrabold text-violet tabular sm:text-3xl">
                {String(games.length).padStart(2, "0")}
              </p>
            </div>
            <button
              onClick={() => isAdmin && setModalOpen(true)}
              disabled={!isAdmin}
              className="group flex flex-1 items-center justify-center gap-2 rounded-2xl border border-pink/30 bg-pink/10 px-4 py-3 text-center transition-all enabled:hover:border-pink/60 enabled:hover:bg-pink/20 enabled:hover:shadow-[0_0_30px_rgba(255,77,141,0.3)] disabled:cursor-default sm:flex-none sm:px-8"
            >
              <Users size={18} className="shrink-0 text-pink transition-transform group-enabled:group-hover:scale-110" />
              <span className="font-mono text-[10px] font-bold tracking-[0.18em] text-pink uppercase">
                {isAdmin ? "Add a game for us" : "P1 & P2 — est. forever"}
              </span>
            </button>
          </div>
        </section>

        {/* ================= view switcher bar ================= */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/8 bg-panel/60 px-3 py-2 backdrop-blur">
          <div className="flex items-center gap-1.5" role="group" aria-label="Layout view">
            <span className="hidden pl-1 pr-1.5 font-mono text-[9px] tracking-[0.28em] text-white/40 uppercase sm:block">
              View
            </span>
            {VIEW_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active = view === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => viewStore.set(opt.id)}
                  aria-pressed={active}
                  title={opt.label}
                  aria-label={opt.label}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 font-mono text-[9px] font-bold tracking-[0.14em] uppercase transition-all ${
                    active
                      ? "border border-pink/50 bg-pink/15 text-pink shadow-[0_0_16px_rgba(255,77,141,0.3)]"
                      : "border border-transparent text-white/45 hover:text-white"
                  }`}
                >
                  <Icon size={14} strokeWidth={2.2} />
                  <span className="hidden sm:inline">{opt.id}</span>
                </button>
              );
            })}
          </div>
          <p className="hidden font-mono text-[8px] tracking-[0.22em] text-white/35 uppercase md:block">
            {isAdmin ? "Click any game to edit it · edits sync instantly" : "Player 1 edits · you're just here for the romance"}
          </p>
        </div>

        {/* ================= sections ================= */}
        <LayoutGroup>
          <CoOpSection
            kind="bought"
            title="Already Bought"
            subtitle="Ready for couch co-op"
            icon={<ShoppingBag size={15} className="text-volt" />}
            accent="#c8ff3e"
            games={bought}
            onAdd={() => setModalOpen(true)}
            emptyCta={isAdmin}
            renderView={renderView}
          />
          <CoOpSection
            kind="wishlist"
            title="Co-Op Wishlist"
            subtitle="Dreaming out loud — future date nights"
            icon={<Heart size={15} className="text-pink" fill="currentColor" />}
            accent="#ff4d8d"
            games={wishlist}
            onAdd={() => setModalOpen(true)}
            emptyCta={isAdmin}
            renderView={renderView}
          />
        </LayoutGroup>

        <p className="mt-10 text-center font-mono text-[9px] tracking-[0.28em] text-white/25 uppercase">
          Co-Op Vault · synced across devices · made with too much love
        </p>
      </main>

      {/* ---------- mobile floating action ---------- */}
      {isAdmin && (
        <button
          onClick={() => setModalOpen(true)}
          aria-label="Add a co-op game"
          className="coop-drift fixed right-5 bottom-5 z-30 grid h-14 w-14 place-items-center rounded-full bg-pink text-void shadow-[0_16px_40px_-8px_rgba(255,77,141,0.55)] transition-transform hover:scale-105 active:scale-95 lg:hidden"
        >
          <Plus size={22} strokeWidth={2.6} />
        </button>
      )}

      {/* ---------- add modal ---------- */}
      <AnimatePresence>
        {modalOpen && (
          <CoOpAddModal
            onClose={() => setModalOpen(false)}
            onAdd={addGame}
            inCollection={inCollection}
          />
        )}
      </AnimatePresence>

      {/* ---------- detail / edit drawer ---------- */}
      <AnimatePresence>
        {selectedGame && (
          <CoOpDetailDrawer
            game={selectedGame}
            onClose={() => setSelectedId(null)}
            onUpdate={updateGame}
            onDelete={removeGame}
          />
        )}
      </AnimatePresence>

      <Toasts toasts={toasts} />
    </div>
  );
}

/* ================================================================== */
/* Section: bought / wishlist                                          */
/* ================================================================== */
function CoOpSection({
  kind,
  title,
  subtitle,
  icon,
  accent,
  games,
  emptyCta,
  onAdd,
  renderView,
}: {
  kind: Section;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accent: string;
  games: CoOpGame[];
  emptyCta: boolean;
  onAdd: () => void;
  renderView: (games: CoOpGame[]) => React.ReactNode;
}) {
  return (
    <section className="mt-8" aria-labelledby={`co-op-${kind}-heading`}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-white/8 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/[0.04]">
            {icon}
          </span>
          <div>
            <h2
              id={`co-op-${kind}-heading`}
              className="font-display text-base font-bold tracking-tight text-ink sm:text-lg"
            >
              {title}
              <span
                className="tabular ml-2 align-middle font-mono text-[10px] font-medium tracking-[0.2em]"
                style={{ color: accent }}
              >
                {String(games.length).padStart(2, "0")}
              </span>
            </h2>
            <p className="font-mono text-[8px] tracking-[0.24em] text-white/35 uppercase sm:text-[9px]">
              {subtitle}
            </p>
          </div>
        </div>
        {kind === "wishlist" && games.length > 0 && (
          <p className="font-mono text-[9px] tracking-[0.2em] text-pink/60 uppercase">
            One tap moves it to the shelf →
          </p>
        )}
      </div>

      {games.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/12 px-6 py-10 text-center">
          <Sparkles size={20} className="mx-auto text-white/20" />
          <p className="mt-3 text-sm font-medium text-white/55">
            {kind === "bought"
              ? "Nothing on the co-op shelf yet."
              : "The wishlist is blissfully empty."}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-white/35">
            {kind === "bought"
              ? "Found a game for the two of you? Add it and it lands right here, ready for date night."
              : "Whisper it into the vault — the next marathon starts with one wish."}
          </p>
          {emptyCta && (
            <button
              onClick={onAdd}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-pink/40 px-4 py-2 font-mono text-[10px] font-bold tracking-[0.16em] text-pink uppercase transition-all hover:bg-pink hover:text-void"
            >
              <Plus size={12} strokeWidth={2.6} />
              Add the first one
            </button>
          )}
        </div>
      ) : (
        renderView(games)
      )}
    </section>
  );
}
