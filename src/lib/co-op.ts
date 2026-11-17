/**
 * Server-side helpers for the Co-Op Vault (src/app/api/co-op + src/app/co-op).
 *
 * Zero-manual-migration setup: /api/co-op and the co-op page both call
 * ensureCoOpTable(), which (1) creates the table if it does not exist and
 * (2) runs idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements
 * so databases created by the first release of this table are upgraded in
 * place — existing rows are preserved and no `drizzle-kit push` is ever
 * required on Vercel. Legacy `status = 'wishlist' | 'bought'` values and the
 * old free-text `note` column are migrated into `isBought` / `notes` with
 * in-place UPDATEs that are harmless no-ops once applied.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { STATUS_ORDER } from "@/lib/constants";
import { COOP_TAGS, type GameStatus, type CoOpTag } from "./types";

let coOpTableReady: Promise<void> | null = null;

export function ensureCoOpTable(): Promise<void> {
  if (!coOpTableReady) {
    coOpTableReady = (async () => {
      // Fresh installs get the full current shape…
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "co_op_games" (
          "id" serial PRIMARY KEY,
          "external_id" text,
          "source" text DEFAULT 'manual',
          "title" text NOT NULL,
          "cover_url" text,
          "hero_url" text,
          "release_year" integer,
          "platforms" text[] DEFAULT '{}',
          "is_bought" boolean NOT NULL DEFAULT false,
          "status" text NOT NULL DEFAULT 'backlog',
          "platform" text,
          "rating" integer,
          "hours_played" integer,
          "is_loved" boolean NOT NULL DEFAULT false,
          "notes" text,
          "coop_tag" text,
          "note" text,
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      // …installs from the first release get every missing column added.
      const alters = [
        `ALTER TABLE "co_op_games" ADD COLUMN IF NOT EXISTS "external_id" text`,
        `ALTER TABLE "co_op_games" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'manual'`,
        `ALTER TABLE "co_op_games" ADD COLUMN IF NOT EXISTS "cover_url" text`,
        `ALTER TABLE "co_op_games" ADD COLUMN IF NOT EXISTS "hero_url" text`,
        `ALTER TABLE "co_op_games" ADD COLUMN IF NOT EXISTS "release_year" integer`,
        `ALTER TABLE "co_op_games" ADD COLUMN IF NOT EXISTS "platforms" text[] DEFAULT '{}'`,
        `ALTER TABLE "co_op_games" ADD COLUMN IF NOT EXISTS "is_bought" boolean NOT NULL DEFAULT false`,
        `ALTER TABLE "co_op_games" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'backlog'`,
        `ALTER TABLE "co_op_games" ADD COLUMN IF NOT EXISTS "platform" text`,
        `ALTER TABLE "co_op_games" ADD COLUMN IF NOT EXISTS "rating" integer`,
        `ALTER TABLE "co_op_games" ADD COLUMN IF NOT EXISTS "hours_played" integer`,
        `ALTER TABLE "co_op_games" ADD COLUMN IF NOT EXISTS "is_loved" boolean NOT NULL DEFAULT false`,
        `ALTER TABLE "co_op_games" ADD COLUMN IF NOT EXISTS "notes" text`,
        `ALTER TABLE "co_op_games" ADD COLUMN IF NOT EXISTS "coop_tag" text`,
        `ALTER TABLE "co_op_games" ADD COLUMN IF NOT EXISTS "note" text`,
        `ALTER TABLE "co_op_games" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now()`,
        `ALTER TABLE "co_op_games" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now()`,
      ];
      for (const stmt of alters) {
        await db.execute(sql.raw(stmt));
      }
      // Backfill legacy rows (release 1 stored ownership in `status`).
      await db.execute(
        sql`UPDATE "co_op_games" SET "is_bought" = true WHERE "status" = 'bought'`,
      );
      await db.execute(
        sql`UPDATE "co_op_games" SET "status" = 'backlog' WHERE "status" = 'bought'`,
      );
      await db.execute(
        sql`UPDATE "co_op_games" SET "status" = 'backlog' WHERE "status" NOT IN ('playing', 'completed', 'backlog', 'wishlist', 'paused', 'dropped')`,
      );
      // Backfill legacy notes.
      await db.execute(
        sql`UPDATE "co_op_games" SET "notes" = "note" WHERE "notes" IS NULL AND "note" IS NOT NULL`,
      );
    })();
    // Reset on failure so the next request retries instead of caching a rejection.
    coOpTableReady.catch(() => {
      coOpTableReady = null;
    });
  }
  return coOpTableReady;
}

// ------------------------------------------------------------ validation ---

export function cleanString(value: unknown, max: number): string | null {
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

export function cleanInt(
  value: unknown,
  min: number,
  max: number,
): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  if (i < min || i > max) return null;
  return i;
}

export function cleanPlatforms(value: unknown, maxItems = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string | number =>
      typeof v === "string" || typeof v === "number",
    )
    .map((v) => String(v).trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, maxItems);
}

/** Play state — mirrors the main vault's STATUS_ORDER semantics. */
export function cleanStatus(value: unknown): GameStatus {
  return STATUS_ORDER.includes(value as GameStatus)
    ? (value as GameStatus)
    : "backlog";
}

export function cleanRating(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 10) return null;
  return n;
}

export function cleanHours(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100000) return null;
  return Math.round(n);
}

export function cleanPlatformText(value: unknown): string | null {
  return cleanString(value, 40);
}

export function cleanBool(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

export function cleanCoopTag(value: unknown): CoOpTag | null {
  const v = cleanString(value, 40);
  if (!v) return null;
  return (COOP_TAGS as readonly string[]).includes(v) ? (v as CoOpTag) : null;
}

/** Admin gate identical in spirit to the library: ?admin=<secret> against env. */
export function isAdminRequest(req: Request): boolean {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("admin");
  const expected =
    process.env.ADMIN_SECRET || process.env.NEXT_PUBLIC_ADMIN_SECRET;
  return Boolean(secret) && secret === expected;
}
