"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BadgePercent,
  Check,
  ChevronDown,
  ExternalLink,
  Gamepad2,
  Globe2,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  Search,
  Star,
  Store,
  Trash2,
  X,
} from "lucide-react";
import {
  ALL_DEALS_CATEGORY,
  MARKET_ORDER,
  formatConsolePrice,
  formatTry,
  type ConsoleMarket,
  type DealCampaign,
  type FxRates,
  type PsnAvailability,
  type PsnDealGame,
  type EnrichedConsoleDeal,
} from "@/lib/psn-deals-data";

// ------------------------------------------------------------------ types --

interface ApiPayload {
  games: PsnDealGame[];
  consoles: EnrichedConsoleDeal[];
  consoleLiveShare: number;
  fx: FxRates;
  watchlist: string[];
  watchlistOk: boolean;
  sources: {
    games: string;
    fx: string;
    consoles: string;
    gamesProvider?: string | null;
    consolesProvider?: string | null;
    fxProvider?: string;
  };
  gamesFetchedAt?: string | null;
  consolesFetchedAt?: string | null;
  campaigns?: DealCampaign[];
  category?: string;
  consolesAsOf: string;
  lastLiveFetch: string | null;
  cacheMaxAgeSeconds: number;
  updatedAt: string;
}

interface LiveLookup {
  status: "loading" | "found" | "not_found" | "error";
  deal?: PsnDealGame | null;
  provider?: string | null;
}

type SortId = "discount" | "price" | "title";

const norm = (t: string) =>
  t
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

const AVAIL_META: Record<
  PsnAvailability,
  { label: string; cls: string; dot: string }
> = {
  in_stock: {
    label: "IN STOCK",
    cls: "border-volt/40 bg-volt/10 text-volt",
    dot: "bg-volt",
  },
  limited: {
    label: "LIMITED",
    cls: "border-amber/40 bg-amber/10 text-amber",
    dot: "bg-amber",
  },
  out_of_stock: {
    label: "OUT OF STOCK",
    cls: "border-rose/40 bg-rose/10 text-rose",
    dot: "bg-rose",
  },
  preorder: {
    label: "PRE-ORDER",
    cls: "border-cyan/40 bg-cyan/10 text-cyan",
    dot: "bg-cyan",
  },
};

const MARKET_DOT: Record<ConsoleMarket, string> = {
  USA: "bg-cyan",
  UK: "bg-violet",
  Europe: "bg-amber",
  Japan: "bg-pink",
  Turkey: "bg-volt",
};

// ------------------------------------------------------------- components --

function SourceBadge({ label, tone }: { label: string; tone: "live" | "snapshot" | "curated" | "fx" }) {
  const cls =
    tone === "live"
      ? "border-volt/40 bg-volt/10 text-volt"
      : tone === "fx"
        ? "border-cyan/40 bg-cyan/10 text-cyan"
        : "border-amber/40 bg-amber/10 text-amber";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] font-bold tracking-[0.18em] uppercase ${cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone === "live" ? "animate-pulse bg-volt" : tone === "fx" ? "bg-cyan" : "bg-amber"}`} />
      {label}
    </span>
  );
}

function DealCover({ title, url }: { title: string; url: string | null }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_50%_30%,rgba(200,255,62,0.12),transparent_70%)] p-3 text-center">
        <Gamepad2 size={30} className="text-volt/60" strokeWidth={1.5} />
        <span className="font-mono text-[9px] leading-snug tracking-[0.14em] text-white/45 uppercase">
          {title}
        </span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={`Box art for ${title}`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className="h-full w-full object-cover"
    />
  );
}

// ------------------------------------------------------------------ page ---

export default function PsnDealsPage() {
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(true);

  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<"All" | "PS5" | "PS4">("All");
  const [sort, setSort] = useState<SortId>("discount");
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [market, setMarket] = useState<"All" | ConsoleMarket>("All");

  const [watchInput, setWatchInput] = useState("");
  const [watchError, setWatchError] = useState<string | null>(null);
  const [watchBusy, setWatchBusy] = useState(false);
  const [lookups, setLookups] = useState<Record<string, LiveLookup>>({});
  const [category, setCategory] = useState(ALL_DEALS_CATEGORY.toLowerCase());
  const [categoryBusy, setCategoryBusy] = useState(false);
  const categoryRef = useRef(category);

  const [tryVal, setTryVal] = useState("1000");
  const [bdtVal, setBdtVal] = useState("");

  useEffect(() => {
    categoryRef.current = category;
  }, [category]);

  /** Fetch the deals grid for ONE campaign category (light payload). */
  const loadCategory = useCallback(async (id: string, force = false) => {
    setCategoryBusy(true);
    setCategory(id);
    try {
      const res = await fetch(
        `/api/psn-deals?category=${encodeURIComponent(id)}${force ? "&refresh=1" : ""}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        games?: PsnDealGame[];
        source?: "live" | "unavailable";
        provider?: string | null;
        fetchedAt?: string | null;
      };
      setData((d) =>
        d
          ? {
              ...d,
              games: json.games ?? [],
              sources: {
                ...d.sources,
                games: json.source === "live" ? "live" : "unavailable",
                gamesProvider: json.provider ?? null,
              },
              gamesFetchedAt: json.fetchedAt ?? null,
            }
          : d,
      );
    } catch (err) {
      console.error("[psn-deals] campaign load failed:", err);
      setData((d) =>
        d
          ? { ...d, games: [], sources: { ...d.sources, games: "unavailable" } }
          : d,
      );
    } finally {
      setCategoryBusy(false);
    }
  }, []);

  const fetchData = useCallback(
    async (force = false) => {
      try {
        const res = await fetch(
          force ? "/api/psn-deals?refresh=1" : "/api/psn-deals",
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ApiPayload;
        setData(json);
        setBdtVal((prev) =>
          prev !== "" ? prev : (1000 * json.fx.bdtPerTry).toFixed(2),
        );
        setLoadError(false);
        // Full payload always carries the default All Deals grid — if the
        // user is viewing another campaign, re-overlay it (force-refresh
        // must refresh the visible category too, not snap it back).
        const active = categoryRef.current;
        if (active !== ALL_DEALS_CATEGORY.toLowerCase()) {
          await loadCategory(active, force);
        }
      } catch (err) {
        console.error("[psn-deals] load failed:", err);
        setLoadError(true);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [loadCategory],
  );

  useEffect(() => {
    // Data fetch on mount; setState happens after awaits, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  const fx = data?.fx ?? null;

  const onTryChange = (v: string) => {
    setTryVal(v);
    if (!fx) return;
    const n = Number.parseFloat(v.replace(",", "."));
    setBdtVal(v.trim() === "" || !Number.isFinite(n) ? "" : (n * fx.bdtPerTry).toFixed(2));
  };
  const onBdtChange = (v: string) => {
    setBdtVal(v);
    if (!fx) return;
    const n = Number.parseFloat(v.replace(",", "."));
    setTryVal(v.trim() === "" || !Number.isFinite(n) ? "" : (n * fx.tryPerBdt).toFixed(2));
  };

  const watchlist = useMemo(() => data?.watchlist ?? [], [data?.watchlist]);
  const watchSet = useMemo(() => new Set(watchlist.map(norm)), [watchlist]);
  const isWatched = useCallback((title: string) => watchSet.has(norm(title)), [watchSet]);

  const dealByTitle = useMemo(() => {
    const map = new Map<string, PsnDealGame>();
    for (const g of data?.games ?? []) map.set(norm(g.title), g);
    return map;
  }, [data?.games]);

  const runLookup = useCallback(async (title: string, force = false) => {
    setLookups((m) => ({ ...m, [title]: { status: "loading" } }));
    try {
      const res = await fetch(
        `/api/psn-deals?query=${encodeURIComponent(title)}${force ? "&refresh=1" : ""}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as {
        results?: PsnDealGame[];
        source?: string;
        provider?: string | null;
      };
      if (!res.ok || json.source === "error") throw new Error("lookup failed");
      const results = json.results ?? [];
      const best =
        results.find((r) => norm(r.title) === norm(title)) ?? results[0] ?? null;
      setLookups((m) => ({
        ...m,
        [title]: { status: best ? "found" : "not_found", deal: best, provider: json.provider ?? null },
      }));
    } catch (err) {
      console.error("[psn-deals] live lookup failed:", err);
      setLookups((m) => ({ ...m, [title]: { status: "error" } }));
    }
  }, []);

  const scanWatchlist = useCallback(
    (titles: string[], force = false) => {
      for (const t of titles.slice(0, 12)) {
        void runLookup(t, force);
      }
    },
    [runLookup],
  );

  // Auto-check the watchlist against the live PSN TR catalog after load.
  useEffect(() => {
    const titles = watchlist;
    if (titles.length === 0) return;
    const t = window.setTimeout(() => scanWatchlist(titles, false), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlist.length]);

  const toggleWatch = useCallback(
    async (title: string) => {
      if (!data) return;
      setWatchError(null);
      setWatchBusy(true);
      try {
        const watched = isWatched(title);
        const res = await fetch(
          watched ? `/api/psn-deals?title=${encodeURIComponent(title)}` : "/api/psn-deals",
          watched
            ? { method: "DELETE" }
            : {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title }),
              },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { watchlist: string[] };
        setData((d) => (d ? { ...d, watchlist: json.watchlist, watchlistOk: true } : d));
        if (!watched) {
          void runLookup(title, true);
        } else {
          setLookups((m) => {
            const next = { ...m };
            delete next[title];
            return next;
          });
        }
      } catch (err) {
        console.error("[psn-deals] watchlist toggle failed:", err);
        setWatchError("Watchlist sync failed — is the database reachable?");
      } finally {
        setWatchBusy(false);
      }
    },
    [data, isWatched, runLookup],
  );

  const addWatchFromInput = useCallback(async () => {
    const title = watchInput.trim();
    if (title.length < 2 || watchBusy) return;
    await toggleWatch(title);
    setWatchInput("");
  }, [watchInput, watchBusy, toggleWatch]);

  const filteredGames = useMemo(() => {
    let list = [...(data?.games ?? [])];
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((g) => g.title.toLowerCase().includes(q));
    if (platform !== "All") list = list.filter((g) => g.platforms.includes(platform));
    if (watchlistOnly) list = list.filter((g) => isWatched(g.title));
    switch (sort) {
      case "price":
        list.sort((a, b) => a.salePrice - b.salePrice);
        break;
      case "title":
        list.sort((a, b) => a.title.localeCompare(b.title));
        break;
      default:
        list.sort((a, b) => b.discountPct - a.discountPct);
    }
    return list;
  }, [data?.games, query, platform, sort, watchlistOnly, isWatched]);

  const watchlistEntries = useMemo(
    () =>
      watchlist.map((title) => ({
        title,
        deal: dealByTitle.get(norm(title)) ?? null,
      })),
    [watchlist, dealByTitle],
  );
  const watchedOnSale = useMemo(
    () => watchlistEntries.filter((e) => e.deal),
    [watchlistEntries],
  );

  const bestBdtDeal = useMemo(() => {
    const rows = (data?.consoles ?? []).filter(
      (c) => c.bdtPrice != null && c.availability !== "out_of_stock",
    );
    if (rows.length === 0) return null;
    return rows.reduce((a, b) =>
      (a.bdtPrice ?? Infinity) <= (b.bdtPrice ?? Infinity) ? a : b,
    );
  }, [data?.consoles]);

  const liveConsoleCount = useMemo(
    () => (data?.consoles ?? []).filter((c) => c.source === "live").length,
    [data?.consoles],
  );

  const filteredConsoles = useMemo(() => {
    const rows = data?.consoles ?? [];
    return market === "All" ? rows : rows.filter((c) => c.market === market);
  }, [data?.consoles, market]);

  const marketCounts = useMemo(() => {
    const rows = data?.consoles ?? [];
    const counts = new Map<ConsoleMarket, number>(MARKET_ORDER.map((m) => [m, 0]));
    for (const c of rows) counts.set(c.market, (counts.get(c.market) ?? 0) + 1);
    return counts;
  }, [data?.consoles]);

  const gameSourceLabel =
    data?.sources.games === "live"
      ? `LIVE SOURCE: ${(data?.sources.gamesProvider ?? "store.playstation.com").toUpperCase()}`
      : "PSN TR UNAVAILABLE";
  const fxLabel =
    data?.fx.source === "live"
      ? `LIVE SOURCE: ${(data?.sources.fxProvider ?? "open.er-api.com").toUpperCase()}`
      : "FX OFFLINE ESTIMATE";
  const consoleSourceLabel =
    liveConsoleCount > 0
      ? `LIVE SOURCE: ${(data?.sources.consolesProvider ?? "playstation.com").toUpperCase()} · ${liveConsoleCount}/${data?.consoles.length}`
      : `CURATED · ${data?.consolesAsOf}`;

  return (
    <main className="min-h-screen bg-void text-ink">
      <div className="stage-bg" />
      <div className="stage-grid" />

      {/* ================= header ================= */}
      <header className="sticky top-0 z-40 border-b border-line bg-void/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="group inline-flex items-center gap-2 font-mono text-[10px] font-bold tracking-[0.22em] text-white/55 uppercase transition-colors hover:text-volt"
          >
            <ArrowLeft size={14} strokeWidth={2.4} className="transition-transform duration-200 group-hover:-translate-x-0.5" />
            Vault
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            {data?.lastLiveFetch && (
              <span className="hidden font-mono text-[9px] tracking-[0.18em] text-volt/70 uppercase md:inline">
                Last live fetch · {new Date(data.lastLiveFetch).toLocaleString()}
              </span>
            )}
            <button
              onClick={() => { setRefreshing(true); fetchData(); }}
              disabled={refreshing}
              aria-label="Refresh prices"
              title="Refresh (cached ≤30 min)"
              className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-panel text-white/70 transition-all hover:border-volt/50 hover:text-volt disabled:opacity-50"
            >
              <RefreshCw size={15} strokeWidth={2.2} className={refreshing ? "animate-spin" : ""} />
            </button>
            <button
              onClick={() => { setRefreshing(true); fetchData(true); }}
              disabled={refreshing}
              className="h-9 rounded-lg border border-volt/50 bg-volt/10 px-3 font-mono text-[9px] font-extrabold tracking-[0.18em] whitespace-nowrap text-volt uppercase transition-all hover:bg-volt hover:text-void disabled:opacity-50"
              title="Bypass cache and hit the live stores now"
            >
              Force live refresh
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 pt-8 pb-16 sm:px-6 sm:pt-10">
        {/* ================= title ================= */}
        <div className="mb-8 flex flex-col gap-4">
          <p className="font-mono text-[10px] font-bold tracking-[0.3em] text-volt uppercase">
            PSN TR · TRY ₺ · WORLDWIDE HARDWARE
          </p>
          <h1 className="font-display text-3xl leading-[1.05] font-extrabold text-white sm:text-5xl">
            PS5 DEALS &amp;
            <br />
            CONSOLE <span className="text-volt">PRICE TRACKER</span>
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-ink-dim">
            Discounted games on the PlayStation Store Turkey (₺), a synced
            watchlist that shouts when your picks go on sale, a TRY ↔ BDT
            converter, and worldwide PS5 console prices across five markets.
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="skeleton aspect-[4/5] rounded-xl" />
            ))}
          </div>
        ) : loadError && !data ? (
          <div className="rounded-2xl border border-rose/30 bg-rose/5 p-10 text-center">
            <p className="font-mono text-xs text-rose">Failed to load deal data.</p>
            <button
              onClick={() => { setRefreshing(true); fetchData(); }}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-volt/50 px-4 py-2 font-mono text-[10px] font-bold tracking-[0.2em] text-volt uppercase transition-colors hover:bg-volt hover:text-void"
            >
              <RefreshCw size={13} /> Retry
            </button>
          </div>
        ) : data ? (
          <>
            {/* ============ SECTION 1 · PSN TURKEY GAME SALES ============ */}
            <section aria-labelledby="psn-tr-heading" className="mb-10">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="font-mono text-[9px] font-bold tracking-[0.3em] text-white/40 uppercase">
                    01 // PSN TURKEY — GAME SALES TRACKER
                  </p>
                  <h2 id="psn-tr-heading" className="font-display mt-1 flex items-center gap-2 text-xl font-bold text-white sm:text-2xl">
                    <BadgePercent size={22} className="text-volt" strokeWidth={2} />
                    Game deals on PSN <span className="text-volt">Turkey</span>
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <SourceBadge label={gameSourceLabel} tone={data.sources.games === "live" ? "live" : "snapshot"} />
                  {watchedOnSale.length > 0 && (
                    <SourceBadge label={`${watchedOnSale.length} WATCHLIST ON SALE`} tone="live" />
                  )}
                </div>
              </div>

              {data.sources.games === "live" ? (
                <p className="mb-3 font-mono text-[9px] tracking-[0.14em] text-volt/80 uppercase">
                  Live from {data.sources.gamesProvider ?? "store.playstation.com"} · fetched{" "}
                  {data.gamesFetchedAt ? new Date(data.gamesFetchedAt).toLocaleString() : "—"} · 30-min cache · Force Live Refresh to bypass
                </p>
              ) : (
                <p className="mb-3 font-mono text-[9px] tracking-[0.14em] text-amber/80 uppercase">
                  PSN Turkey deals unavailable — PS Store unreachable/blocked and all live aggregators failed · no fake games are shown · Force Live Refresh to retry
                </p>
              )}
              {!data.watchlistOk && (
                <p className="mb-3 font-mono text-[9px] tracking-[0.14em] text-rose/80 uppercase">
                  Watchlist unavailable — database unreachable or migration not run (npx drizzle-kit push)
                </p>
              )}

              <div className="grid gap-4 lg:grid-cols-3">
                {/* -------- main deals column -------- */}
                <div className="lg:col-span-2">
                  {/* deal campaign pills (mirrors the official PS Store deals hub) */}
                  <div
                    role="tablist"
                    aria-label="Deal campaigns"
                    className="mb-3 flex flex-wrap items-center gap-2"
                  >
                    {(data.campaigns ?? []).map((c) => {
                      const active = category === c.id;
                      return (
                        <button
                          key={c.id}
                          role="tab"
                          aria-selected={active}
                          disabled={categoryBusy}
                          onClick={() => loadCategory(c.id)}
                          title={`Show ${c.title} deals`}
                          className={`inline-flex h-8 items-center gap-2 rounded-lg border px-3 font-mono text-[9px] font-bold tracking-[0.16em] whitespace-nowrap uppercase transition-all disabled:opacity-60 ${
                            active
                              ? "border-volt bg-volt text-void shadow-[0_0_18px_rgba(200,255,62,0.25)]"
                              : "border-line bg-panel text-white/60 hover:border-volt/50 hover:text-volt"
                          }`}
                        >
                          {c.imageUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={c.imageUrl}
                              alt=""
                              aria-hidden
                              className="h-4 w-6 rounded-sm object-cover"
                            />
                          )}
                          {c.title}
                          {active && categoryBusy && <Loader2 size={11} className="animate-spin" />}
                        </button>
                      );
                    })}
                  </div>

                  {/* controls */}
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-panel px-3 focus-within:border-volt/50">
                      <Search size={14} className="shrink-0 text-white/35" />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="SEARCH PSN TR SALES…"
                        aria-label="Filter games on sale"
                        className="h-full w-full bg-transparent font-mono text-[11px] tracking-wide text-ink outline-none placeholder:text-white/30"
                      />
                      {query && (
                        <button onClick={() => setQuery("")} aria-label="Clear filter" className="text-white/40 hover:text-white">
                          <X size={14} />
                        </button>
                      )}
                    </label>
                    <div className="flex rounded-lg border border-line bg-panel p-1">
                      {(["All", "PS5", "PS4"] as const).map((p) => (
                        <button
                          key={p}
                          onClick={() => setPlatform(p)}
                          className={`rounded-md px-3 py-1.5 font-mono text-[9px] font-bold tracking-[0.18em] uppercase transition-colors ${
                            platform === p ? "bg-volt text-void" : "text-white/55 hover:text-white"
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <div className="relative">
                      <select
                        value={sort}
                        onChange={(e) => setSort(e.target.value as SortId)}
                        aria-label="Sort deals"
                        className="h-10 appearance-none rounded-lg border border-line bg-panel pr-8 pl-3 font-mono text-[10px] font-bold tracking-[0.14em] text-white/75 uppercase outline-none focus:border-volt/50"
                      >
                        <option value="discount">Sort · Discount</option>
                        <option value="price">Sort · Price ↑</option>
                        <option value="title">Sort · Title A–Z</option>
                      </select>
                      <ChevronDown size={13} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-white/40" />
                    </div>
                    <button
                      onClick={() => setWatchlistOnly((v) => !v)}
                      aria-pressed={watchlistOnly}
                      className={`inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 font-mono text-[9px] font-bold tracking-[0.18em] uppercase transition-colors ${
                        watchlistOnly ? "border-volt/60 bg-volt/15 text-volt" : "border-line bg-panel text-white/60 hover:text-white"
                      }`}
                    >
                      <Star size={12} strokeWidth={2.4} fill={watchlistOnly ? "currentColor" : "none"} />
                      Watchlist
                    </button>
                  </div>

                  {/* deals grid */}
                  {filteredGames.length === 0 ? (
                    <div className="rounded-2xl border border-line bg-panel/50 p-10 text-center">
                      {query || watchlistOnly ? (
                        <p className="font-mono text-[10px] tracking-[0.18em] text-white/40 uppercase">
                          No deals match “{query || "watchlist"}”{watchlistOnly ? " in your watchlist" : ""}
                        </p>
                      ) : (
                        <>
                          <p className="font-mono text-[10px] tracking-[0.18em] text-amber/80 uppercase">
                            Live PSN Turkey deals couldn&apos;t be loaded
                          </p>
                          <p className="mt-2 font-mono text-[9px] tracking-[0.14em] text-white/35 uppercase">
                            PS Store unreachable/blocked and all live aggregators failed
                          </p>
                          <button
                            onClick={() => { setRefreshing(true); fetchData(true); }}
                            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-volt/50 px-4 py-2 font-mono text-[10px] font-bold tracking-[0.2em] text-volt uppercase transition-colors hover:bg-volt hover:text-void"
                          >
                            <RefreshCw size={13} /> Force live refresh
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                      {filteredGames.map((g) => {
                        const watched = isWatched(g.title);
                        return (
                          <div
                            key={g.id}
                            className={`group relative flex flex-col overflow-hidden rounded-xl border bg-panel-2 transition-all duration-200 ${
                              watched
                                ? "border-volt/70 shadow-[0_0_34px_rgba(200,255,62,0.16)]"
                                : "border-line hover:border-white/20"
                            }`}
                          >
                            <a
                              href={g.url ?? "#"}
                              target="_blank"
                              rel="noreferrer"
                              className="relative block aspect-[3/4] overflow-hidden"
                              aria-label={`View ${g.title} on PlayStation Store Turkey`}
                            >
                              <DealCover title={g.title} url={g.coverUrl} />
                              <span className="absolute top-2 left-2 rounded-md bg-volt px-1.5 py-0.5 font-mono text-[10px] font-extrabold text-void">
                                −{g.discountPct}%
                              </span>
                            </a>
                            <button
                              onClick={() => toggleWatch(g.title)}
                              disabled={watchBusy}
                              aria-pressed={watched}
                              aria-label={watched ? `Unwatch ${g.title}` : `Watch ${g.title}`}
                              title={watched ? "Remove from watchlist" : "Add to watchlist"}
                              className={`absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-md border backdrop-blur transition-all ${
                                watched
                                  ? "border-volt/70 bg-volt text-void"
                                  : "border-white/15 bg-black/55 text-white/70 hover:border-volt/60 hover:text-volt"
                              }`}
                            >
                              <Star size={13} strokeWidth={2.2} fill={watched ? "currentColor" : "none"} />
                            </button>
                            <div className="flex grow flex-col gap-1.5 p-2.5">
                              <p className="line-clamp-2 min-h-[2.4em] text-[11px] leading-tight font-semibold text-white">
                                {g.title}
                              </p>
                              <div className="mt-auto space-y-0.5">
                                <p className="font-mono text-[9px] text-white/35 line-through">
                                  {formatTry(g.basePrice)}
                                </p>
                                <p className="font-mono text-sm font-bold text-volt">
                                  {formatTry(g.salePrice)}
                                </p>
                                <div className="flex items-center justify-between gap-1 pt-0.5">
                                  <span className="font-mono text-[8px] tracking-[0.16em] text-white/40 uppercase">
                                    {g.platforms.join(" / ")}
                                  </span>
                                  {watched && (
                                    <span className="rounded border border-volt/50 bg-volt/15 px-1 py-0.5 font-mono text-[7px] font-extrabold tracking-[0.18em] text-volt uppercase">
                                      Watching
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* -------- sidebar: watchlist + FX converter -------- */}
                <div className="flex flex-col gap-4">
                  {/* watchlist */}
                  <div className="rounded-2xl border border-line bg-panel p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h3 className="font-mono text-[10px] font-bold tracking-[0.25em] text-white/70 uppercase">
                        Custom Watchlist
                      </h3>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => scanWatchlist(watchlist, true)}
                          title="Re-check live PSN TR prices for everything on the list"
                          aria-label="Live re-check of watchlist prices"
                          className="grid h-6 w-6 place-items-center rounded-md border border-line text-white/45 transition-colors hover:border-volt/50 hover:text-volt"
                        >
                          <RefreshCw size={11} strokeWidth={2.4} />
                        </button>
                        <span className="rounded-full border border-volt/40 bg-volt/10 px-2 py-0.5 font-mono text-[9px] font-bold text-volt">
                          {watchlist.length}
                        </span>
                      </div>
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        addWatchFromInput();
                      }}
                      className="mb-3 flex items-center gap-2"
                    >
                      <input
                        value={watchInput}
                        onChange={(e) => setWatchInput(e.target.value)}
                        placeholder="Track a game on PSN TR…"
                        aria-label="Add a game to the watchlist"
                        className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 font-mono text-[11px] text-ink outline-none placeholder:text-white/30 focus:border-volt/60"
                      />
                      <button
                        type="submit"
                        disabled={watchBusy || watchInput.trim().length < 2}
                        aria-label="Add to watchlist"
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-volt/50 text-volt transition-all hover:bg-volt hover:text-void disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {watchBusy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} strokeWidth={2.6} />}
                      </button>
                    </form>
                    {watchError && (
                      <p className="mb-2 font-mono text-[9px] tracking-[0.12em] text-rose uppercase">{watchError}</p>
                    )}
                    {watchlist.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-line p-4 text-center font-mono text-[9px] leading-relaxed tracking-[0.14em] text-white/35 uppercase">
                        Nothing tracked yet.
                        <br />
                        Add games above — or tap ★ on any deal.
                      </p>
                    ) : (
                      <ul className="flex max-h-[320px] flex-col gap-2 overflow-y-auto pr-1">
                        {watchlistEntries.map(({ title, deal }) => (
                          <li
                            key={title}
                            className={`rounded-xl border p-2.5 transition-colors ${
                              deal ? "border-volt/60 bg-volt/[0.08]" : "border-line bg-panel-2"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="min-w-0 text-[11px] leading-snug font-semibold break-words text-white">
                                {title}
                              </p>
                              <button
                                onClick={() => toggleWatch(title)}
                                disabled={watchBusy}
                                aria-label={`Remove ${title} from watchlist`}
                                className="shrink-0 text-white/35 transition-colors hover:text-rose"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                            <div className="mt-1.5 flex items-center gap-2">
                              {deal ? (
                                <>
                                  <span className="inline-flex animate-pulse items-center gap-1 rounded border border-volt/60 bg-volt px-1.5 py-0.5 font-mono text-[8px] font-extrabold tracking-[0.2em] text-void uppercase">
                                    On sale
                                  </span>
                                  <span className="font-mono text-[10px] font-bold text-volt">
                                    {formatTry(deal.salePrice)}
                                  </span>
                                  <span className="font-mono text-[9px] text-white/40">−{deal.discountPct}%</span>
                                </>
                              ) : (
                                <span className="font-mono text-[8px] tracking-[0.18em] text-white/35 uppercase">
                                  Not in active TR deals list
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-2 border-t border-white/5 pt-1.5">
                              <span className="font-mono text-[7px] tracking-[0.2em] text-white/30 uppercase">Live PSN TR:</span>
                              {(() => {
                                const lk = lookups[title];
                                if (!lk || lk.status === "loading")
                                  return <span className="font-mono text-[8px] text-white/35 uppercase">checking…</span>;
                                if (lk.status === "error")
                                  return <span className="font-mono text-[8px] text-rose/80 uppercase">lookup failed</span>;
                                if (lk.status === "not_found" || !lk.deal)
                                  return <span className="font-mono text-[8px] text-white/35 uppercase">not found in catalog</span>;
                                const d = lk.deal;
                                return (
                                  <span className="flex items-center gap-1.5 font-mono text-[9px]">
                                    {lk.provider && (
                                      <span className="text-[7px] text-white/25 uppercase">via {lk.provider}</span>
                                    )}
                                    {d.discountPct > 0 ? (
                                      <>
                                        <span className="rounded bg-amber/15 px-1 py-0.5 text-[8px] font-extrabold text-amber">
                                          ON SALE · LIVE −{d.discountPct}%
                                        </span>
                                        <span className="font-bold text-volt">{formatTry(d.salePrice)}</span>
                                        <span className="text-[8px] text-white/35 line-through">{formatTry(d.basePrice)}</span>
                                      </>
                                    ) : (
                                      <span className="text-[8px] tracking-[0.15em] text-white/35 uppercase">
                                        No active discount · {formatTry(d.basePrice)}
                                      </span>
                                    )}
                                  </span>
                                );
                              })()}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* TRY <-> BDT converter */}
                  <div className="rounded-2xl border border-volt/25 bg-gradient-to-br from-panel to-panel-2 p-4">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <h3 className="font-mono text-[10px] font-bold tracking-[0.25em] text-volt uppercase">
                        ₺ TRY ↔ ৳ BDT Converter
                      </h3>
                      <SourceBadge label={fxLabel} tone="fx" />
                    </div>
                    <p className="mb-3 font-mono text-[8px] tracking-[0.18em] text-white/35 uppercase">
                      Free public rate · open.er-api.com
                    </p>
                    <div className="space-y-2">
                      <label className="block">
                        <span className="mb-1 flex items-center justify-between font-mono text-[9px] tracking-[0.2em] text-white/50 uppercase">
                          Turkish Lira <span>₺ TRY</span>
                        </span>
                        <div className="flex items-center rounded-lg border border-line bg-void/60 focus-within:border-volt/60">
                          <span className="pl-3 font-mono text-sm text-volt">₺</span>
                          <input
                            inputMode="decimal"
                            value={tryVal}
                            onChange={(e) => onTryChange(e.target.value)}
                            aria-label="Amount in Turkish lira"
                            className="h-11 w-full bg-transparent px-2 font-mono text-base font-bold text-white outline-none"
                          />
                        </div>
                      </label>
                      <div className="flex items-center justify-center">
                        <span className="rounded-full border border-line bg-panel px-3 py-1 font-mono text-[9px] tracking-[0.25em] text-white/45 uppercase">↕ swap</span>
                      </div>
                      <label className="block">
                        <span className="mb-1 flex items-center justify-between font-mono text-[9px] tracking-[0.2em] text-white/50 uppercase">
                          Bangladeshi Taka <span>৳ BDT</span>
                        </span>
                        <div className="flex items-center rounded-lg border border-line bg-void/60 focus-within:border-volt/60">
                          <span className="pl-3 font-mono text-sm text-cyan">৳</span>
                          <input
                            inputMode="decimal"
                            value={bdtVal}
                            onChange={(e) => onBdtChange(e.target.value)}
                            aria-label="Amount in Bangladeshi taka"
                            className="h-11 w-full bg-transparent px-2 font-mono text-base font-bold text-white outline-none"
                          />
                        </div>
                      </label>
                    </div>
                    {fx && (
                      <div className="mt-3 border-t border-line pt-3">
                        <p className="font-mono text-[11px] font-bold text-white/85">
                          1 ₺ ≈ {fx.bdtPerTry.toFixed(4)} ৳
                          <span className="mx-2 text-white/25">·</span>1 ৳ ≈ {fx.tryPerBdt.toFixed(4)} ₺
                        </p>
                        <p className="mt-1 font-mono text-[8px] tracking-[0.16em] text-white/35 uppercase">
                          Rate as of {fx.asOf}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {["1000", "2500", "5000", "10000"].map((chip) => (
                            <button
                              key={chip}
                              onClick={() => onTryChange(chip)}
                              className="rounded-md border border-line bg-void/50 px-2 py-1 font-mono text-[9px] text-white/55 transition-colors hover:border-volt/50 hover:text-volt"
                            >
                              ₺{Number(chip).toLocaleString()}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* ============ SECTION 2 · WORLDWIDE PS5 CONSOLE SALES ============ */}
            <section aria-labelledby="world-heading">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="font-mono text-[9px] font-bold tracking-[0.3em] text-white/40 uppercase">
                    02 // WORLDWIDE — PS5 CONSOLE SALES TRACKER
                  </p>
                  <h2 id="world-heading" className="font-display mt-1 flex items-center gap-2 text-xl font-bold text-white sm:text-2xl">
                    <Globe2 size={22} className="text-volt" strokeWidth={2} />
                    PS5 hardware deals, <span className="text-volt">five markets</span>
                  </h2>
                </div>
                <SourceBadge
                  label={consoleSourceLabel}
                  tone={liveConsoleCount > 0 ? "live" : "curated"}
                />
              </div>
              <p className="mb-3 font-mono text-[9px] leading-relaxed tracking-[0.14em] text-white/40 uppercase">
                {liveConsoleCount > 0 ? (
                  <>
                    Live from {data.sources.consolesProvider ?? "playstation.com"} buy-now pages · fetched{" "}
                    {data.consolesFetchedAt ? new Date(data.consolesFetchedAt).toLocaleString() : "—"} · regions without live data keep the labelled{" "}
                    {data.consolesAsOf} baseline ·{" "}
                  </>
                ) : (
                  <>Curated {data.consolesAsOf} baseline (PS Store pages unreachable) · </>
                )}
                All prices auto-converted to ৳ BDT at the live FX rate · confirm with retailer
              </p>

              {bestBdtDeal && (
                <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-volt/40 bg-volt/[0.07] px-4 py-2.5">
                  <span className="font-mono text-[9px] font-extrabold tracking-[0.25em] text-volt uppercase">
                    Best PS5 price in Taka
                  </span>
                  <span className="font-mono text-[11px] font-bold text-white">
                    {bestBdtDeal.market} · {bestBdtDeal.name}
                  </span>
                  <span className="font-mono text-sm font-extrabold text-volt">
                    ৳{Math.round(bestBdtDeal.bdtPrice ?? 0).toLocaleString("en-US")}
                  </span>
                  <span className="font-mono text-[8px] tracking-[0.16em] text-white/45 uppercase">
                    {bestBdtDeal.retailer} · {bestBdtDeal.source} · converted @ live FX
                  </span>
                </div>
              )}

              {/* market filter */}
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setMarket("All")}
                  className={`rounded-lg border px-3 py-2 font-mono text-[9px] font-bold tracking-[0.18em] uppercase transition-colors ${
                    market === "All" ? "border-volt bg-volt text-void" : "border-line bg-panel text-white/60 hover:text-white"
                  }`}
                >
                  All · {data.consoles.length}
                </button>
                {MARKET_ORDER.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMarket(m)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 font-mono text-[9px] font-bold tracking-[0.18em] uppercase transition-colors ${
                      market === m ? "border-volt bg-volt text-void" : "border-line bg-panel text-white/60 hover:text-white"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${MARKET_DOT[m]}`} />
                    {m} · {marketCounts.get(m) ?? 0}
                  </button>
                ))}
              </div>

              {/* console board */}
              <div className="overflow-x-auto rounded-2xl border border-line">
                <table className="w-full min-w-[1060px] border-collapse text-left">
                  <thead>
                    <tr className="bg-panel-2">
                      {["Console / Bundle", "Market", "Price", "Was", "≈ BDT", "Stock", "Retailer", ""].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-3 font-mono text-[9px] font-bold tracking-[0.22em] text-white/40 uppercase"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredConsoles.map((c, i) => {
                      const avail = AVAIL_META[c.availability];
                      return (
                        <tr
                          key={c.id}
                          className={`border-t border-line align-top ${i % 2 === 0 ? "bg-panel/40" : "bg-transparent"} transition-colors hover:bg-volt/[0.04]`}
                        >
                          <td className="max-w-[280px] px-4 py-3">
                            <p className="text-[12px] leading-snug font-semibold text-white">{c.name}</p>
                            {c.note && (
                              <p className="mt-0.5 font-mono text-[8px] leading-snug tracking-wide text-violet/90 uppercase">
                                {c.note}
                              </p>
                            )}
                            {c.note && (
                              <span className="mt-1 inline-block rounded border border-violet/40 bg-violet/10 px-1 py-0.5 font-mono text-[7px] font-extrabold tracking-[0.2em] text-violet uppercase">
                                Bundle
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-[0.16em] text-white/75 uppercase">
                              <span className={`h-1.5 w-1.5 rounded-full ${MARKET_DOT[c.market]}`} />
                              {c.market}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-mono text-sm font-extrabold whitespace-nowrap text-volt">
                              {formatConsolePrice(c)}
                            </p>
                            {c.discountPct != null && (
                              <p className="font-mono text-[9px] font-bold text-amber">SAVE {c.discountPct}%</p>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-[10px] whitespace-nowrap text-white/35 line-through">
                            {c.originalPrice != null ? formatConsolePrice({ ...c, price: c.originalPrice }) : "—"}
                          </td>
                          <td className="px-4 py-3 align-middle font-mono text-[11px] whitespace-nowrap">
                            {c.bdtPrice != null ? (
                              <span className="font-bold text-cyan">
                                ≈ ৳{Math.round(c.bdtPrice).toLocaleString("en-US")}
                              </span>
                            ) : (
                              <span className="text-white/35">—</span>
                            )}
                            <span
                              className={`mt-0.5 block text-[7px] font-extrabold tracking-[0.18em] uppercase ${
                                c.source === "live" ? "text-volt" : "text-amber"
                              }`}
                            >
                              {c.source === "live" ? "● Live" : "○ Curated"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[8px] font-extrabold tracking-[0.18em] whitespace-nowrap uppercase ${avail.cls}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${avail.dot}`} />
                              {avail.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-[10px] whitespace-nowrap text-white/65">
                            {c.retailer}
                          </td>
                          <td className="px-4 py-3">
                            <a
                              href={c.url}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Check live price for ${c.name} at ${c.retailer}`}
                              title={`Check live price at ${c.retailer}`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line text-white/50 transition-all hover:border-volt/60 hover:text-volt"
                            >
                              <ExternalLink size={13} />
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 font-mono text-[8px] tracking-[0.16em] text-white/35 uppercase">
                <span className="inline-flex items-center gap-1.5"><Store size={10} /> Prices in local currency (USD · GBP · EUR · JPY · TRY)</span>
                <span className="inline-flex items-center gap-1.5"><MonitorSmartphone size={10} /> Turkey shelf prices include local taxes/fees</span>
                <span>Curated snapshot · {data.consolesAsOf}</span>
              </div>
            </section>
          </>
        ) : null}

        {/* ================= footer ================= */}
        <footer className="mt-12 border-t border-line pt-6">
          <p className="font-mono text-[8px] leading-relaxed tracking-[0.14em] text-white/30 uppercase">
            Unofficial tracker — not affiliated with or endorsed by Sony
            Interactive Entertainment or any retailer. PSN Turkey prices are
            shown in Turkish Lira (₺) as listed on the store; live data is
            best-effort and may lag or be replaced by a dated snapshot. Console
            prices are a curated worldwide snapshot ({data?.consolesAsOf ?? "…"}).
            FX via open.er-api.com. Always confirm the final price on the
            retailer&apos;s page before purchase.
          </p>
        </footer>
      </div>
    </main>
  );
}
