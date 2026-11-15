import { db } from "@/db";
import { psnWatchlist } from "@/db/schema";
import { asc, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  CONSOLES_AS_OF,
  TURKEY_SNAPSHOT_AS_OF,
} from "@/lib/psn-deals-data";
import { getConsoleDeals, getFxRates, getTurkeyDeals } from "@/lib/psn-deals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TITLE = 120;

async function readWatchlist(): Promise<{ titles: string[]; ok: boolean }> {
  try {
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

export async function GET() {
  const [fx, turkey] = await Promise.all([getFxRates(), getTurkeyDeals()]);
  const wl = await readWatchlist();

  return NextResponse.json({
    games: turkey.games,
    consoles: getConsoleDeals(),
    fx,
    watchlist: wl.titles,
    watchlistOk: wl.ok,
    sources: {
      games: turkey.source,
      fx: fx.source,
      consoles: "curated",
    },
    gamesAsOf: turkey.asOf ?? null,
    consolesAsOf: CONSOLES_AS_OF,
    snapshotAsOf: TURKEY_SNAPSHOT_AS_OF,
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
