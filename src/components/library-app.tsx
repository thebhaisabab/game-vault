"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Plus } from "lucide-react";
import type { LibraryGame } from "@/db/schema";
import {
  formatGames,
  type LibraryView,
  type SortId,
} from "@/lib/constants";
import type { GameSearchResult } from "@/lib/types";
import SideRail from "./side-rail";
import HeaderHero from "./header-hero";
import FilterBar, { type StatusFilter } from "./filter-bar";
import LibraryViewPane from "./library-view";
import DetailDrawer, { type GamePatch } from "./detail-drawer";
import SearchModal, { type AddOutcome } from "./search-modal";
import Toasts, { type Toast } from "./toasts";

const LIBRARY_VIEWS: LibraryView[] = ["grid", "list", "showcase"];

export default function LibraryApp({ initialGames }: { initialGames: LibraryGame[] }) {
  const [games, setGames] = useState<LibraryGame[]>(initialGames);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [platformFilter, setPlatformFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortId>("added_desc");
  const [view, setView] = useState<LibraryView>("grid");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  // ---------- admin verification ----------
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const secret = params.get("admin");
      const expectedSecret = process.env.NEXT_PUBLIC_ADMIN_SECRET;

      if (secret && expectedSecret && secret === expectedSecret) {
        sessionStorage.setItem("gv_admin", "true");
        setIsAdmin(true);
      } else if (sessionStorage.getItem("gv_admin") === "true") {
        setIsAdmin(true);
      }
    } catch {
      /* private mode fallback */
    }
  }, []);

  const adminQuery = useMemo(() => {
    const secret = process.env.NEXT_PUBLIC_ADMIN_SECRET;
    return secret ? `?admin=${encodeURIComponent(secret)}` : "";
  }, []);

  const gamesRef = useRef(games);
  gamesRef.current = games;

  // ---------- toasts ----------
  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
    window.setTimeout(
      () => setToasts((ts) => ts.filter((x) => x.id !== id)),
      t.kind === "err" ? 6500 : 4200,
    );
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((ts) => ts.filter((x) => x.id !== id));
  }, []);

  const handleAddIntent = useCallback(() => {
    if (!isAdmin) {
      pushToast({
        title: "Viewing Mode",
        detail: "Only Sabab can add games to this vault",
        kind: "info",
      });
      return;
    }
    setModalOpen(true);
  }, [isAdmin, pushToast]);

  // ---------- persisted view ----------
  useEffect(() => {
    try {
      const v = window.localStorage.getItem("gv-view");
      if (v && LIBRARY_VIEWS.includes(v as LibraryView)) setView(v as LibraryView);
    } catch {
      /* private mode */
    }
  }, []);

  const changeView = useCallback((v: LibraryView) => {
    setView(v);
    try {
      window.localStorage.setItem("gv-view", v);
    } catch {
      /* private mode */
    }
  }, []);

  // ---------- scroll lock ----------
  const overlayOpen = modalOpen || selectedId !== null;
  useEffect(() => {
    if (overlayOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [overlayOpen]);

  // ---------- shortcuts ----------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (modalOpen || selectedId !== null) return;
      if ((e.key === "a" || e.key === "A") && isAdmin) setModalOpen(true);
      if (e.key === "/") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>("[data-lib-search]")?.focus();
      }
      if (e.key === "1") changeView("grid");
      if (e.key === "2") changeView("list");
      if (e.key === "3") changeView("showcase");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [modalOpen, selectedId, changeView, isAdmin]);

  // ---------- data ops (optimistic, synced to Postgres) ----------
  const updateGame = useCallback(
    async (id: number, patch: GamePatch): Promise<boolean> => {
      if (!isAdmin) return false;
      const prev = gamesRef.current.find((g) => g.id === id);
      setGames((gs) => gs.map((g) => (g.id === id ? ({ ...g, ...patch } as LibraryGame) : g)));
      try {
        const res = await fetch(`/api/library/${id}${adminQuery}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { game: LibraryGame };
        setGames((gs) => gs.map((g) => (g.id === id ? data.game : g)));
        return true;
      } catch {
        if (prev) setGames((gs) => gs.map((g) => (g.id === id ? prev : g)));
        pushToast({
          title: "Couldn't sync that change",
          detail: "Your edit was reverted",
          kind: "err",
        });
        return false;
      }
    },
    [isAdmin, adminQuery, pushToast],
  );

  const deleteGame = useCallback(
    async (id: number) => {
      if (!isAdmin) return;
      const snapshot = gamesRef.current.find((g) => g.id === id);
      if (!snapshot) return;
      setGames((gs) => gs.filter((g) => g.id !== id));
      setSelectedId((s) => (s === id ? null : s));

      try {
        const res = await fetch(`/api/library/${id}${adminQuery}`, { method: "DELETE" });
        if (!res.ok) throw new Error(String(res.status));
        pushToast({
          title: `Removed “${snapshot.title}”`,
          kind: "info",
          action: {
            label: "Undo",
            run: () => {
              void (async () => {
                try {
                  const { id: _omit, ...payload } = snapshot;
                  void _omit;
                  const res2 = await fetch(`/api/library${adminQuery}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                  });
                  if (!res2.ok) throw new Error(String(res2.status));
                  const data = (await res2.json()) as { game: LibraryGame };
                  setGames((gs) => [data.game, ...gs]);
                  pushToast({ title: "Restored from the void", kind: "ok" });
                } catch {
                  pushToast({ title: "Undo failed", kind: "err" });
                }
              })();
            },
          },
        });
      } catch {
        setGames((gs) => [snapshot, ...gs]);
        pushToast({ title: "Couldn't remove the game", kind: "err" });
      }
    },
    [isAdmin, adminQuery, pushToast],
  );

  const addToLibrary = useCallback(
    async (payload: Record<string, unknown>, label: string): Promise<AddOutcome> => {
      if (!isAdmin) {
        pushToast({ title: "Admin access required", detail: "Only Sabab can add games", kind: "err" });
        return "error";
      }
      try {
        const res = await fetch(`/api/library${adminQuery}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { game: LibraryGame; conflict: boolean };
        if (data.conflict) {
          pushToast({ title: "Already in your vault", detail: label, kind: "info" });
          return "exists";
        }
        setGames((gs) => [data.game, ...gs]);
        pushToast({ title: "Added to your vault", detail: label, kind: "ok" });
        return "added";
      } catch {
        pushToast({ title: "Couldn't add that game", detail: "Try again", kind: "err" });
        return "error";
      }
    },
    [isAdmin, adminQuery, pushToast],
  );

  const addFromSearch = useCallback(
    (r: GameSearchResult) =>
      addToLibrary(
        {
          externalId: r.externalId,
          source: r.source,
          title: r.title,
          coverUrl: r.coverUrl,
          heroUrl: r.heroUrl,
          summary: r.summary,
          developer: r.developer,
          publisher: r.publisher,
          genres: r.genres,
          platforms: r.platforms,
          releaseYear: r.releaseYear,
          releaseDate: r.releaseDate,
          criticScore: r.criticScore,
          status: "backlog",
        },
        r.title,
      ),
    [addToLibrary],
  );

  const addManual = useCallback(
    (input: { title: string; platform: string | null; releaseYear: number | null }) =>
      addToLibrary(
        { source: "manual", externalId: null, ...input },
        input.title,
      ),
    [addToLibrary],
  );

  const inLibrary = useCallback(
    (externalId: string | null) =>
      !!externalId && games.some((g) => g.externalId === externalId),
    [games],
  );

  // ---------- derived data ----------
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of games) counts[g.status] = (counts[g.status] ?? 0) + 1;
    return counts;
  }, [games]);

  const favoritesCount = useMemo(() => games.filter((g) => g.favorite).length, [games]);

  const platformCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of games) {
      if (g.platform) counts[g.platform] = (counts[g.platform] ?? 0) + 1;
    }
    return counts;
  }, [games]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = games;
    if (statusFilter === "favorites") list = list.filter((g) => g.favorite);
    else if (statusFilter !== "all") list = list.filter((g) => g.status === statusFilter);
    if (platformFilter) list = list.filter((g) => g.platform === platformFilter);
    if (q) {
      list = list.filter((g) =>
        [g.title, g.developer ?? "", g.platform ?? "", ...(g.genres ?? [])]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    const sorted = [...list];
    switch (sort) {
      case "added_desc":
        sorted.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
        break;
      case "added_asc":
        sorted.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
        break;
      case "title_asc":
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "release_desc":
        sorted.sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0));
        break;
      case "release_asc":
        sorted.sort((a, b) => (a.releaseYear ?? 9999) - (b.releaseYear ?? 9999));
        break;
      case "rating_desc":
        sorted.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
        break;
      case "score_desc":
        sorted.sort((a, b) => (b.criticScore ?? -1) - (a.criticScore ?? -1));
        break;
    }
    return sorted;
  }, [games, statusFilter, platformFilter, query, sort]);

  const selected = selectedId !== null ? (games.find((g) => g.id === selectedId) ?? null) : null;
  const isFiltered = statusFilter !== "all" || platformFilter !== null || query.length > 0;

  const railFilter =
    statusFilter === "playing" ? "playing" : statusFilter === "favorites" ? "favorites" : "all";
  const onRailFilter = (f: "all" | "playing" | "favorites") => {
    setStatusFilter(f);
    setPlatformFilter(null);
    setQuery("");
  };

  return (
    <div className="min-h-screen">
      <div className="stage-bg" />
      <div className="stage-grid" />
      <div className="stage-noise" />

      <div className="flex">
        <SideRail
          filter={railFilter}
          onFilter={onRailFilter}
          onAdd={handleAddIntent}
          count={games.length}
          playingCount={statusCounts.playing ?? 0}
          favoritesCount={favoritesCount}
        />

        <div className="min-w-0 flex-1">
          <HeaderHero games={games} />

          <FilterBar
            statusFilter={statusFilter}
            onStatusFilter={setStatusFilter}
            statusCounts={statusCounts}
            favoritesCount={favoritesCount}
            platformFilter={platformFilter}
            onPlatformFilter={setPlatformFilter}
            platformCounts={platformCounts}
            query={query}
            onQuery={setQuery}
            sort={sort}
            onSort={setSort}
            view={view}
            onView={changeView}
            total={games.length}
          />

          <main className="px-4 py-7 sm:px-8 lg:px-12">
            <p className="mb-4 font-mono text-[10px] tracking-[0.24em] text-white/35 uppercase">
              {isFiltered
                ? `${formatGames(filtered.length)} of ${formatGames(games.length)} shown`
                : formatGames(games.length)}
              {" · "}
              {view === "grid" ? "tile view" : view === "list" ? "list view" : "showcase view"}
            </p>
            <LibraryViewPane
              view={view}
              games={filtered}
              isFiltered={isFiltered}
              onOpen={(g) => setSelectedId(g.id)}
              onToggleFavorite={(g) => {
                if (isAdmin) void updateGame(g.id, { favorite: !g.favorite });
              }}
              onAdd={isAdmin ? handleAddIntent : undefined}
            />
          </main>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-6 sm:px-8 lg:px-12">
            <p className="font-mono text-[10px] tracking-[0.2em] text-white/30 uppercase">
              Game Vault — {formatGames(games.length)} · synced across every device
            </p>
            <p className="font-mono text-[10px] tracking-[0.2em] text-white/30 uppercase">
              {isAdmin ? (
                <>
                  Press <span className="text-volt">A</span> to add ·{" "}
                  <span className="text-volt">1·2·3</span> to switch views
                </>
              ) : (
                <>
                  <span className="text-volt">1·2·3</span> to switch views
                </>
              )}
            </p>
          </footer>
        </div>
      </div>

      {/* mobile FAB */}
      {!modalOpen && isAdmin && (
        <button
          onClick={handleAddIntent}
          aria-label="Add a game"
          className="fixed right-5 bottom-5 z-30 grid h-14 w-14 place-items-center rounded-full bg-volt text-void shadow-[0_16px_40px_-8px_rgba(200,255,62,0.45)] transition-transform hover:scale-105 active:scale-95 lg:hidden"
        >
          <Plus size={22} strokeWidth={2.6} />
        </button>
      )}

      <AnimatePresence>
        {modalOpen && isAdmin && (
          <SearchModal
            key="search-modal"
            onClose={() => setModalOpen(false)}
            onAdd={addFromSearch}
            onAddManual={addManual}
            inLibrary={inLibrary}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selected && (
          <DetailDrawer
            key="detail-drawer"
            game={selected}
            onClose={() => setSelectedId(null)}
            onUpdate={updateGame}
            onDelete={deleteGame}
          />
        )}
      </AnimatePresence>

      <Toasts toasts={toasts.map((t) => ({
        ...t,
        action: t.action
          ? { label: t.action.label, run: () => { dismissToast(t.id); t.action!.run(); } }
          : undefined,
      }))} />
    </div>
  );
}
