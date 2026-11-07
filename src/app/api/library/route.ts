import { db } from "@/db";
import { libraryGames } from "@/db/schema";
import { STATUS_ORDER } from "@/lib/constants";
import type { GameStatus } from "@/lib/types";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db
    .select()
    .from(libraryGames)
    .orderBy(desc(libraryGames.addedAt));
  return NextResponse.json({ games: rows });
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") {
    if (typeof value === "number" || typeof value === "boolean") {
      value = String(value);
    } else {
      return null;
    }
  }
  const v = (value as string).trim().slice(0, max);
  return v.length ? v : null;
}

function cleanInt(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  if (i < min || i > max) return null;
  return i;
}

function cleanStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" || typeof v === "number")
    .map((v) => String(v).trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, maxItems);
}

function cleanStatus(value: unknown): GameStatus {
  return STATUS_ORDER.includes(value as GameStatus)
    ? (value as GameStatus)
    : "backlog";
}

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const adminSecret = searchParams.get("admin");
  const expectedSecret =
    process.env.ADMIN_SECRET || process.env.NEXT_PUBLIC_ADMIN_SECRET;

  if (!adminSecret || adminSecret !== expectedSecret) {
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

  const externalId = cleanString(body.externalId, 80);

  // De-dupe: if the game is already in the vault, return the existing row.
  if (externalId) {
    const [existing] = await db
      .select()
      .from(libraryGames)
      .where(eq(libraryGames.externalId, externalId))
      .limit(1);
    if (existing) {
      return NextResponse.json({ game: existing, conflict: true });
    }
  }

  const values = {
    externalId,
    source: cleanString(body.source, 20) ?? "manual",
    title,
    coverUrl: cleanString(body.coverUrl, 600),
    heroUrl: cleanString(body.heroUrl, 600),
    summary: cleanString(body.summary, 4000),
    developer: cleanString(body.developer, 160),
    publisher: cleanString(body.publisher, 160),
    genres: cleanStringArray(body.genres, 8),
    platforms: cleanStringArray(body.platforms, 24),
    releaseYear: cleanInt(body.releaseYear, 1950, 2100),
    releaseDate: cleanString(body.releaseDate, 24),
    criticScore: cleanInt(body.criticScore, 1, 100),
    status: cleanStatus(body.status),
    rating: cleanInt(body.rating, 1, 10),
    hoursPlayed: cleanInt(body.hoursPlayed, 0, 100000),
    platform: cleanString(body.platform, 40),
    notes: cleanString(body.notes, 4000),
    favorite: body.favorite === true,
  };

  try {
    const [row] = await db.insert(libraryGames).values(values).returning();
    return NextResponse.json({ game: row, conflict: false }, { status: 201 });
  } catch (err) {
    console.error("Database insert error:", err);
    return NextResponse.json({ error: "database_error", details: String(err) }, { status: 500 });
  }
}
