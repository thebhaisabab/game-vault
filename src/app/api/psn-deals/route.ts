import { asc, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { TURKEY_SNAPSHOT_AS_OF, CONSOLES_AS_OF } from "@/lib/psn-deals-data";

import {
  getConsoleBoard,
  getFxRates,
  getTurkeyDeals,
  liveMeta,
  searchPsnTrLive,
  REVALIDATE_SECONDS,
} from "@/lib/psn-deals";

// Live fetches use next.revalidate = 1800s (30 min) from the lib, so external
// calls stay cached and rate-limit-safe while this handler stays dynamic
// (watchlist DB reads must always be fresh).
// ?refresh=1 bypasses every cache. ?query=<title> does a live catalog lookup.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TITLE = 120;

async function getDb() {
  const [{ db }, { psnWatchlist }] = await Promise.all([
    import("@/db"),
    import("@/db/schema"),
  ]);
  return { db, psnWatchlist };
}

async function readWatchlist(): Promise<{ titles: string[]; ok: boolean }> {
  try {
    const { db, psnWatchlist } = await getDb();
    const rows = await db
      .select({ title: psnWatchlist.title })
      .from(psnWatchlist)
      .orderBy(asc(psnWatchlist.title));
    return { titles: rows.map((r) => r.title), ok: true };
  } catch (err) {
    // Table missing (migration not run) or DB unreachable — degrade gracefully.
    console.error(
      "[psn-deals] Watchlist read failed. Run `npx drizzle-kit push` to create psn_watchlist.",
      err,
    );
    return { titles: [], ok: false };
  }
}

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
      return NextResponse.json(
        { results, source: "live", provider },
      );
    } catch (err) {
      console.error("[psn-deals] Watchlist live lookup failed:", err);
      return NextResponse.json(
        { results: [], source: "error", provider: null },
        { status: 200 },
      );
    }
  }

  // ---- Full payload -------------------------------------------------------
  const fx = await getFxRates({ force });
  const [turkey, board] = await Promise.all([
    getTurkeyDeals({ force }),
    getConsoleBoard(fx, { force }),
  ]);
  const wl = await readWatchlist();
  const meta = liveMeta();
  const liveStamps = [meta.lastLiveGamesAt, meta.lastLiveConsolesAt, meta.lastLiveFxAt]
    .filter((v): v is string => v != null)
    .sort();

  return NextResponse.json({
    games: turkey.games,
    consoles: board.rows,
    consoleLiveShare:
      board.rows.length > 0 ? board.liveCount / board.rows.length : 0,
    fx,
    watchlist: wl.titles,
    watchlistOk: wl.ok,
    sources: {
      games: turkey.source,
      consoles: board.liveCount > 0 ? "live" : "curated",
      fx: fx.source === "live" ? "live" : "fallback",
      gamesProvider: turkey.provider,
      consolesProvider: board.provider,
      fxProvider: "open.er-api.com",
    },
    gamesAsOf: turkey.asOf ?? null,
    consolesAsOf: CONSOLES_AS_OF,
    snapshotAsOf: TURKEY_SNAPSHOT_AS_OF,
    gamesFetchedAt: meta.lastLiveGamesAt,
    consolesFetchedAt: meta.lastLiveConsolesAt,
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

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const title = cleanTitle(body.title);
  if (!title) {
    return NextResponse.json({ error: "title_required" }, { status: 400 });
  }
  try {
    const { db, psnWatchlist } = await getDb();
    await db
      .insert(psnWatchlist)
      .values({ title })
      .onConflictDoNothing({ target: psnWatchlist.title });
  } catch (err) {
    console.error(
      "[psn-deals] Watchlist insert failed. Run `npx drizzle-kit push` to create psn_watchlist.",
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
    const { db, psnWatchlist } = await getDb();
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
