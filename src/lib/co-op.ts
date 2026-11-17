/**
 * Server-side helpers for the Co-Op Vault (src/app/api/co-op + src/app/co-op).
 *
 * Zero-manual-migration setup: /api/co-op and the co-op page both call
 * ensureCoOpTable(), which runs an idempotent `CREATE TABLE IF NOT EXISTS
 * "co_op_games"` once per server instance before touching the table — Vercel
 * never needs a manual `drizzle-kit push` for this table. On failure the flag
 * resets and the next call retries (matching the psn_watchlist pattern).
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { COOP_TAGS, type CoOpStatus, type CoOpTag } from "./types";

let coOpTableReady: Promise<void> | null = null;

export function ensureCoOpTable(): Promise<void> {
  if (!coOpTableReady) {
    coOpTableReady = (async () => {
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
          "status" text NOT NULL DEFAULT 'wishlist',
          "coop_tag" text,
          "note" text,
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        )
      `);
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

export function cleanStatus(value: unknown): CoOpStatus {
  return value === "bought" ? "bought" : "wishlist";
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
