import { asc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  ALL_DEALS_CATEGORY,
  CONSOLES_AS_OF,
  type DealCampaign,
  type PsnDealGame,
} from "@/lib/psn-deals-data";

import {
  getConsoleBoard,
  getFxRates,
  getTurkeyDeals,
  getDealCampaigns,
  liveMeta,
  parseApolloState,
  sanitizeCategoryId,
  searchPsnTrLive,
  REVALIDATE_SECONDS,
  type TurkeyDealsResult,
} from "@/lib/psn-deals";
import { getEdgeDb } from "@/db/edge";
import { psnDealsCache, psnWatchlist } from "@/db/schema";

// Edge Runtime: requests to the official PSN Storefront GraphQL API leave from
// Vercel/Cloudflare edge IPs instead of the Akamai-blocked AWS Lambda range.
// All DB access goes through Neon's HTTP driver (src/db/edge.ts) — node-postgres
// cannot run here. Live fetches are Data-Cached (?refresh=1 bypasses).
export const dynamic = "force-dynamic";
export const runtime = "edge";

const MAX_TITLE = 120;
const ALL_DEALS_KEY = `games:${ALL_DEALS_CATEGORY.toLowerCase()}`;
const gamesCacheKey = (categoryId: string) => `games:${categoryId.toLowerCase()}`;
const CAMPAIGNS_CACHE_KEY = "campaigns";

const asIso = (v: unknown): string | null =>
  typeof v === "string" && v.trim() && !Number.isNaN(Date.parse(v))
    ? new Date(v).toISOString()
    : null;

// ------------------------------------------------------- Neon cache --------
// Idempotent, once per server instance; resets on failure so the next request
// retries. When DATABASE_URL is missing every cache call degrades to a no-op
// (read → miss, write → skipped) — deals still serve live when reachable.
let cacheTableReady: Promise<void> | null = null;

function ensureCacheTable(): Promise<void> {
  if (!cacheTableReady) {
    cacheTableReady = (async () => {
      const db = getEdgeDb();
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "psn_deals_cache" (
          "cache_key" text PRIMARY KEY,
          "payload" jsonb NOT NULL,
          "provider" text,
          "fetched_at" timestamptz NOT NULL DEFAULT now()
        )
      `);
    })();
    cacheTableReady.catch(() => {
      cacheTableReady = null;
    });
  }
  return cacheTableReady;
}

const asCachedDeal = (value: unknown): PsnDealGame | null => {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const title = typeof r.title === "string" ? r.title.trim() : "";
  const base = Number(r.basePrice);
  const sale = Number(r.salePrice);
  if (title.length < 2 || title.length > 160) return null;
  if (!Number.isFinite(base) || !Number.isFinite(sale) || base <= 0 || sale <= 0 || sale > base) {
    return null;
  }
  const rawPlatforms = Array.isArray(r.platforms) ? r.platforms : [];
  const platforms = rawPlatforms.filter(
    (p): p is "PS5" | "PS4" => p === "PS5" || p === "PS4",
  );
  const rawPct = Number(r.discountPct);
  const discountPct = Number.isFinite(rawPct)
    ? Math.min(95, Math.max(0, Math.round(rawPct)))
    : Math.min(95, Math.max(0, Math.round((1 - sale / base) * 100)));
  const coverUrl =
    typeof r.coverUrl === "string" && r.coverUrl.startsWith("http")
      ? r.coverUrl
      : null;
  const url =
    typeof r.url === "string" && r.url.startsWith("http") ? r.url : null;
  return {
    id:
      typeof r.id === "string" && r.id.trim()
        ? r.id.trim()
        : `psn-cache-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`,
    title,
    platforms: platforms.length > 0 ? platforms : ["PS5"],
    basePrice: Math.round(base),
    salePrice: Math.round(sale),
    discountPct,
    coverUrl,
    url,
  };
};

const asCachedCampaign = (value: unknown): DealCampaign | null => {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim().toLowerCase() : "";
  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }
  if (title.length < 2 || title.length > 48) return null;
  const imageUrl =
    typeof r.imageUrl === "string" && r.imageUrl.startsWith("http")
      ? r.imageUrl
      : null;
  return { id, title, imageUrl };
};

interface GamesCacheHit {
  games: PsnDealGame[];
  provider: string | null;
  fetchedAt: string | null;
}

async function readGamesCache(key: string): Promise<GamesCacheHit | null> {
  try {
    await ensureCacheTable();
    const db = getEdgeDb();
    const rows = await db
      .select()
      .from(psnDealsCache)
      .where(eq(psnDealsCache.cacheKey, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const rawGames = (row.payload as { games?: unknown } | null)?.games;
    if (!Array.isArray(rawGames)) return null;
    const games = rawGames
      .map(asCachedDeal)
      .filter((g): g is PsnDealGame => g != null);
    if (games.length === 0) return null;
    const provider = typeof row.provider === "string" ? row.provider : null;
    return { games, provider, fetchedAt: asIso(row.fetchedAt) };
  } catch (err) {
    console.error("[psn-deals] Games cache read failed (DB missing/unreachable):", err);
    return null;
  }
}

async function writeGamesCache(
  key: string,
  games: PsnDealGame[],
  provider: string | null,
): Promise<string | null> {
  try {
    await ensureCacheTable();
    const db = getEdgeDb();
    const fetchedAt = new Date().toISOString();
    await db
      .insert(psnDealsCache)
      .values({
        cacheKey: key,
        payload: { games },
        provider,
        fetchedAt,
      })
      .onConflictDoUpdate({
        target: psnDealsCache.cacheKey,
        set: { payload: { games }, provider, fetchedAt },
      });
    return fetchedAt;
  } catch (err) {
    console.error("[psn-deals] Games cache write failed (DB missing/unreachable):", err);
    return null;
  }
}

interface CampaignsCacheHit {
  campaigns: DealCampaign[];
  fetchedAt: string | null;
}

async function readCampaignsCache(): Promise<CampaignsCacheHit | null> {
  try {
    await ensureCacheTable();
    const db = getEdgeDb();
    const rows = await db
      .select()
      .from(psnDealsCache)
      .where(eq(psnDealsCache.cacheKey, CAMPAIGNS_CACHE_KEY))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const raw = (row.payload as { campaigns?: unknown } | null)?.campaigns;
    if (!Array.isArray(raw)) return null;
    const campaigns = raw
      .map(asCachedCampaign)
      .filter((c): c is DealCampaign => c != null);
    if (campaigns.length === 0) return null;
    return { campaigns, fetchedAt: asIso(row.fetchedAt) };
  } catch (err) {
    console.error("[psn-deals] Campaigns cache read failed (DB missing/unreachable):", err);
    return null;
  }
}

async function writeCampaignsCache(
  campaigns: DealCampaign[],
  provider: string | null,
): Promise<void> {
  try {
    await ensureCacheTable();
    const db = getEdgeDb();
    const fetchedAt = new Date().toISOString();
    await db
      .insert(psnDealsCache)
      .values({
        cacheKey: CAMPAIGNS_CACHE_KEY,
        payload: { campaigns },
        provider,
        fetchedAt,
      })
      .onConflictDoUpdate({
        target: psnDealsCache.cacheKey,
        set: { payload: { campaigns }, provider, fetchedAt },
      });
  } catch (err) {
    console.error("[psn-deals] Campaigns cache write failed (DB missing/unreachable):", err);
  }
}

type GamesSource = "live" | "cache" | "unavailable";

interface GamesResolution {
  games: PsnDealGame[];
  source: GamesSource;
  provider: string | null;
  /** Live fetch time, or the cache row's write time when served from Neon. */
  syncedAt: string | null;
}

/**
 * Zero-failure guarantee: a live fetch is written through to Neon; when the
 * live fetch fails (blocked/rotated hash/outage) the last-known-good copy is
 * served from Neon with its timestamp — on every device.
 */
async function resolveGamesWithCache(
  live: TurkeyDealsResult,
  cacheKey: string,
): Promise<GamesResolution> {
  if (live.source === "live") {
    const syncedAt =
      (await writeGamesCache(cacheKey, live.games, live.provider)) ??
      new Date().toISOString();
    return { games: live.games, source: "live", provider: live.provider, syncedAt };
  }
  const hit = await readGamesCache(cacheKey);
  if (hit) {
    return {
      games: hit.games,
      source: "cache",
      provider: hit.provider ? `${hit.provider} · served from Neon cache` : "Neon cache",
      syncedAt: hit.fetchedAt,
    };
  }
  return { games: [], source: "unavailable", provider: null, syncedAt: null };
}

/**
 * Campaign tabs: prefer the live storefront extraction (writes through to
 * Neon); fall back to the last synced tab list when the hub page is blocked.
 */
async function resolveCampaignsWithCache(
  liveCampaigns: DealCampaign[],
): Promise<DealCampaign[]> {
  if (liveCampaigns.length > 1) {
    await writeCampaignsCache(liveCampaigns, "store.playstation.com/pages/deals");
    return liveCampaigns;
  }
  const hit = await readCampaignsCache();
  if (hit && hit.campaigns.length > 0) return hit.campaigns;
  return liveCampaigns;
}

// ------------------------------------------------------ Watchlist ---------
// Zero-migration watchlist setup: make sure the psn_watchlist table exists
// before touching it. Vercel deploys don't run `drizzle-kit push`, so the
// table is created here, idempotently, once per server instance. On failure
// the flag resets and the next request retries — and the UI falls back to
// localStorage (watchlistOk:false).
let watchlistTableReady: Promise<void> | null = null;

function ensureWatchlistTable(): Promise<void> {
  if (!watchlistTableReady) {
    watchlistTableReady = (async () => {
      const db = getEdgeDb();
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "psn_watchlist" (
          "id" serial PRIMARY KEY,
          "title" text NOT NULL UNIQUE,
          "created_at" timestamp NOT NULL DEFAULT now()
        )
      `);
    })();
    // Reset on failure so the next request retries instead of caching a rejection.
    watchlistTableReady.catch(() => {
      watchlistTableReady = null;
    });
  }
  return watchlistTableReady;
}

async function readWatchlist(): Promise<{ titles: string[]; ok: boolean }> {
  try {
    await ensureWatchlistTable();
    const db = getEdgeDb();
    const rows = await db
      .select({ title: psnWatchlist.title })
      .from(psnWatchlist)
      .orderBy(asc(psnWatchlist.title));
    return { titles: rows.map((r) => r.title), ok: true };
  } catch (err) {
    // DB unreachable / DATABASE_URL missing — degrade gracefully; the UI
    // falls back to a browser-local watchlist.
    console.error(
      "[psn-deals] Watchlist read failed (DATABASE_URL missing or DB unreachable):",
      err,
    );
    return { titles: [], ok: false };
  }
}

// Live fetches use next.revalidate = 1800s (30 min) from the lib, so external
// calls stay cached and rate-limit-safe while this handler stays dynamic
// (watchlist DB reads must always be fresh).
// ?refresh=1 bypasses every cache. ?query=<title> does a live catalog lookup.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("refresh") === "1";
  const query = searchParams.get("query")?.trim() ?? "";

  // ---- Live catalog lookup for a specific title (watchlist pricing) ----
  if (query) {
    if (query.length < 2) {
      return NextResponse.json({ results: [], source: "none", provider: null });
    }
    try {
      const { results, provider } = await searchPsnTrLive(query, { force });
      return NextResponse.json({ results, source: "live", provider });
    } catch (err) {
      console.error("[psn-deals] Watchlist live lookup failed:", err);
      return NextResponse.json(
        { results: [], source: "error", provider: null },
        { status: 200 },
      );
    }
  }

  // ---- Live games for ONE campaign category (pill switching) -------------
  const categoryParam = searchParams.get("category");
  if (categoryParam) {
    const categoryId = sanitizeCategoryId(categoryParam);
    const live = await getTurkeyDeals({ force, categoryId });
    const resolved = await resolveGamesWithCache(live, gamesCacheKey(categoryId));
    return NextResponse.json({
      games: resolved.games,
      source: resolved.source,
      provider: resolved.provider,
      category: categoryId,
      fetchedAt: resolved.syncedAt,
      cacheMaxAgeSeconds: REVALIDATE_SECONDS,
    });
  }

  // ---- Full payload -------------------------------------------------------
  const fx = await getFxRates({ force });
  const [turkey, board] = await Promise.all([
    getTurkeyDeals({ force }),
    getConsoleBoard(fx, { force }),
  ]);
  const games = await resolveGamesWithCache(turkey, ALL_DEALS_KEY);
  const wl = await readWatchlist();
  const campaigns = await resolveCampaignsWithCache(await getDealCampaigns({ force }));
  const meta = liveMeta();
  const liveStamps = [
    meta.lastLiveGamesAt,
    meta.lastLiveConsolesAt,
    meta.lastLiveFxAt,
    games.syncedAt,
  ]
    .filter((v): v is string => v != null)
    .sort();

  return NextResponse.json({
    games: games.games,
    campaigns,
    category: ALL_DEALS_CATEGORY.toLowerCase(),
    consoles: board.rows,
    consoleLiveShare:
      board.rows.length > 0 ? board.liveCount / board.rows.length : 0,
    fx,
    watchlist: wl.titles,
    watchlistOk: wl.ok,
    sources: {
      games: games.source,
      consoles: board.liveCount > 0 ? "live" : "curated",
      fx: fx.source === "live" ? "live" : "fallback",
      gamesProvider: games.provider,
      consolesProvider: board.provider,
      fxProvider: "open.er-api.com",
    },
    consolesAsOf: CONSOLES_AS_OF,
    gamesFetchedAt: games.syncedAt,
    consolesFetchedAt: meta.lastLiveConsolesAt,
    lastSyncAt: games.syncedAt,
    lastLiveFetch: liveStamps.length > 0 ? liveStamps[liveStamps.length - 1] : null,
    cacheMaxAgeSeconds: REVALIDATE_SECONDS,
    updatedAt: new Date().toISOString(),
  });
}

function cleanTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().slice(0, MAX_TITLE);
  return v.length >= 2 ? v : null;
}

const MAX_NEXT_DATA_CHARS = 8 * 1024 * 1024; // 8 MB of pasted JSON is plenty

/** Accept a raw JSON string (from the copy button) or an already-parsed object. */
function coerceNextData(raw: unknown): unknown {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0) throw new NextDataError("empty_payload", 400);
    if (trimmed.length > MAX_NEXT_DATA_CHARS) {
      throw new NextDataError("payload_too_large", 413);
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new NextDataError("invalid_json", 400);
    }
  }
  if (raw && typeof raw === "object") return raw;
  throw new NextDataError("invalid_payload", 400);
}

class NextDataError extends Error {
  readonly status: number;
  constructor(code: string, status: number) {
    super(code);
    this.status = status;
  }
}

/**
 * "Sync from PSN Tab" import: the user copies window.__NEXT_DATA__ from an
 * open deals-hub / All Deals tab, pastes it here, and the exact Apollo state
 * Sony shipped to their browser is parsed — deals + campaign tabs are saved
 * to the Neon cache and served on every device immediately.
 */
async function handleNextDataImport(raw: unknown): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = coerceNextData(raw);
  } catch (err) {
    if (err instanceof NextDataError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
  const { games, campaigns } = parseApolloState(payload);
  if (games.length === 0) {
    return NextResponse.json(
      {
        error: "no_deals_found",
        hint: "No priced products were found. Open https://store.playstation.com/en-tr/pages/deals (while signed in), run copy(JSON.stringify(window.__NEXT_DATA__)) in the console, and paste the result.",
      },
      { status: 422 },
    );
  }
  const lastSyncAt = new Date().toISOString();
  const provider = "store.playstation.com (manual sync)";
  // The pasted hub page renders the All Deals grid — persist both under the
  // All Deals key so every client fetch (any category pinned to All Deals)
  // serves the copy.
  const gamesSaved = await writeGamesCache(ALL_DEALS_KEY, games, provider);
  if (campaigns.length > 0) {
    await writeCampaignsCache(campaigns, provider);
  }
  if (gamesSaved == null) {
    // Parsed fine but nothing was persisted — say exactly that.
    return NextResponse.json(
      {
        error: "cache_unavailable",
        parsedGames: games.length,
        parsedCampaigns: campaigns.length,
        hint: "Deals parsed but could not be saved — DATABASE_URL missing or Neon unreachable.",
      },
      { status: 503 },
    );
  }
  return NextResponse.json(
    {
      ok: true,
      games,
      campaigns,
      importedGames: games.length,
      importedCampaigns: campaigns.length,
      provider,
      lastSyncAt,
    },
    { status: 200 },
  );
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // ---- Manual "Sync from PSN Tab" import ---------------------------------
  if (body.nextData !== undefined && body.nextData !== null) {
    return handleNextDataImport(body.nextData);
  }

  const title = cleanTitle(body.title);
  if (!title) {
    return NextResponse.json({ error: "title_required" }, { status: 400 });
  }
  try {
    await ensureWatchlistTable();
    const db = getEdgeDb();
    await db
      .insert(psnWatchlist)
      .values({ title })
      .onConflictDoNothing({ target: psnWatchlist.title });
  } catch (err) {
    console.error(
      "[psn-deals] Watchlist insert failed (DATABASE_URL missing or DB unreachable):",
      err,
    );
    return NextResponse.json(
      { error: "watchlist_unavailable" },
      { status: 503 },
    );
  }
  const wl = await readWatchlist();
  return NextResponse.json({ watchlist: wl.titles }, { status: 201 });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  let title = searchParams.get("title");
  if (!title) {
    try {
      const body = (await req.json()) as Record<string, unknown> | null;
      title = typeof body?.title === "string" ? body.title : null;
    } catch {
      title = null;
    }
  }
  title = cleanTitle(title);
  if (!title) {
    return NextResponse.json({ error: "title_required" }, { status: 400 });
  }
  try {
    await ensureWatchlistTable();
    const db = getEdgeDb();
    await db
      .delete(psnWatchlist)
      .where(sql`lower(${psnWatchlist.title}) = ${title.toLowerCase()}`);
  } catch (err) {
    console.error("[psn-deals] Watchlist delete failed.", err);
    return NextResponse.json(
      { error: "watchlist_unavailable" },
      { status: 503 },
    );
  }
  const wl = await readWatchlist();
  return NextResponse.json({ watchlist: wl.titles });
}
