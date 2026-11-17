import { asc, desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { coOpGames } from "@/db/schema";
import {
  cleanBool,
  cleanCoopTag,
  cleanHours,
  cleanInt,
  cleanPlatforms,
  cleanPlatformText,
  cleanRating,
  cleanStatus,
  cleanString,
  ensureCoOpTable,
  isAdminRequest,
} from "@/lib/co-op";

export const dynamic = "force-dynamic";

/**
 * Co-Op Vault API — Player 1 & Player 2's shared shelf.
 *   GET    → open read (anyone can view the vault)
 *   POST   → admin only: add a game          ({ title, isBought?, status?, ... })
 *   PATCH  → admin only: partial update      ({ id, isBought?, status?, platform?,
 *                                               rating?, hoursPlayed?, isLoved?,
 *                                               notes?, coopTag?, ... })
 *   DELETE → admin only: remove              (?id=123 or { id })
 * The co_op_games table (and every column) is created/upgraded idempotently on
 * first use — no manual migration needed on Vercel.
 */
export async function GET() {
  try {
    await ensureCoOpTable();
    const games = await db
      .select()
      .from(coOpGames)
      .orderBy(desc(coOpGames.createdAt), asc(coOpGames.title));
    return NextResponse.json({ games, ok: true });
  } catch (err) {
    console.error("[co-op] read failed:", err);
    return NextResponse.json(
      { games: [], ok: false, error: "database_unavailable" },
      { status: 503 },
    );
  }
}

export async function POST(req: Request) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const title = cleanString(body.title, 200);
  if (!title) {
    return NextResponse.json({ error: "title_required" }, { status: 400 });
  }

  const isBought = cleanBool(body.isBought);

  const values = {
    externalId: cleanString(body.externalId, 80),
    source: cleanString(body.source, 20) ?? "manual",
    title,
    coverUrl: cleanString(body.coverUrl, 600),
    heroUrl: cleanString(body.heroUrl, 600),
    releaseYear: cleanInt(body.releaseYear, 1950, 2100),
    platforms: cleanPlatforms(body.platforms),
    isBought,
    status:
      body.status !== undefined
        ? cleanStatus(body.status)
        : isBought
          ? "backlog"
          : "wishlist",
    platform: cleanPlatformText(body.platform),
    rating: cleanRating(body.rating),
    hoursPlayed: cleanHours(body.hoursPlayed),
    isLoved: cleanBool(body.isLoved),
    notes:
      cleanString(body.notes, 4000) ??
      // tolerate the release-1 field name
      cleanString(body.note, 500),
    coopTag: cleanCoopTag(body.coopTag),
  };

  try {
    await ensureCoOpTable();
    const [row] = await db.insert(coOpGames).values(values).returning();
    return NextResponse.json({ game: row }, { status: 201 });
  } catch (err) {
    console.error("[co-op] insert failed:", err);
    return NextResponse.json(
      { error: "database_unavailable" },
      { status: 503 },
    );
  }
}

function parseId(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(req: Request) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const id = parseId(body.id);
  if (!id) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if ("isBought" in body) patch.isBought = cleanBool(body.isBought);
  if ("status" in body) patch.status = cleanStatus(body.status);
  if ("platform" in body) {
    patch.platform =
      body.platform === null ? null : cleanPlatformText(body.platform);
  }
  if ("rating" in body) {
    patch.rating = body.rating === null ? null : cleanRating(body.rating);
  }
  if ("hoursPlayed" in body) {
    patch.hoursPlayed =
      body.hoursPlayed === null ? null : cleanHours(body.hoursPlayed);
  }
  if ("isLoved" in body) patch.isLoved = cleanBool(body.isLoved);
  if ("notes" in body) {
    patch.notes = body.notes === null ? null : cleanString(body.notes, 4000);
  }
  if ("coopTag" in body) patch.coopTag = cleanCoopTag(body.coopTag);
  if ("title" in body) {
    const title = cleanString(body.title, 200);
    if (!title) return NextResponse.json({ error: "bad_title" }, { status: 400 });
    patch.title = title;
  }
  if ("coverUrl" in body) patch.coverUrl = cleanString(body.coverUrl, 600);
  if ("releaseYear" in body) {
    patch.releaseYear = cleanInt(body.releaseYear, 1950, 2100);
  }
  if ("platforms" in body) patch.platforms = cleanPlatforms(body.platforms);

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing_to_patch" }, { status: 400 });
  }
  patch.updatedAt = sql`now()`;

  try {
    await ensureCoOpTable();
    const [row] = await db
      .update(coOpGames)
      .set(patch)
      .where(eq(coOpGames.id, id))
      .returning();
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ game: row });
  } catch (err) {
    console.error("[co-op] patch failed:", err);
    return NextResponse.json(
      { error: "database_unavailable" },
      { status: 503 },
    );
  }
}

export async function DELETE(req: Request) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  let id = parseId(searchParams.get("id"));
  if (!id) {
    try {
      const body = (await req.json()) as Record<string, unknown> | null;
      id = parseId(body?.id);
    } catch {
      id = null;
    }
  }
  if (!id) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  try {
    await ensureCoOpTable();
    const [row] = await db
      .delete(coOpGames)
      .where(eq(coOpGames.id, id))
      .returning();
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[co-op] delete failed:", err);
    return NextResponse.json(
      { error: "database_unavailable" },
      { status: 503 },
    );
  }
}
