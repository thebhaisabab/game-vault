import { db } from "@/db";
import { libraryGames } from "@/db/schema";
import { STATUS_ORDER } from "@/lib/constants";
import type { GameStatus } from "@/lib/types";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(req: Request, ctx: Ctx) {
  const id = parseId((await ctx.params).id);
  if (!id) return Response.json({ error: "bad_id" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if ("status" in body) {
    if (!STATUS_ORDER.includes(body.status as GameStatus)) {
      return Response.json({ error: "bad_status" }, { status: 400 });
    }
    patch.status = body.status;
  }
  if ("rating" in body) {
    if (body.rating === null) patch.rating = null;
    else {
      const n = Number(body.rating);
      if (!Number.isInteger(n) || n < 1 || n > 10) {
        return Response.json({ error: "bad_rating" }, { status: 400 });
      }
      patch.rating = n;
    }
  }
  if ("hoursPlayed" in body) {
    if (body.hoursPlayed === null) patch.hoursPlayed = null;
    else {
      const n = Number(body.hoursPlayed);
      if (!Number.isFinite(n) || n < 0 || n > 100000) {
        return Response.json({ error: "bad_hours" }, { status: 400 });
      }
      patch.hoursPlayed = Math.round(n);
    }
  }
  if ("platform" in body) {
    patch.platform =
      typeof body.platform === "string" && body.platform.trim()
        ? body.platform.trim().slice(0, 40)
        : null;
  }
  if ("notes" in body) {
    patch.notes =
      typeof body.notes === "string" && body.notes.trim()
        ? body.notes.slice(0, 4000)
        : null;
  }
  if ("favorite" in body) {
    patch.favorite = body.favorite === true;
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "nothing_to_patch" }, { status: 400 });
  }

  patch.updatedAt = sql`now()`;

  const [row] = await db
    .update(libraryGames)
    .set(patch)
    .where(eq(libraryGames.id, id))
    .returning();

  if (!row) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ game: row });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const id = parseId((await ctx.params).id);
  if (!id) return Response.json({ error: "bad_id" }, { status: 400 });

  const [row] = await db
    .delete(libraryGames)
    .where(eq(libraryGames.id, id))
    .returning();

  if (!row) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ game: row });
}
