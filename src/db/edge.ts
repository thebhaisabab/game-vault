/**
 * Edge-runtime-safe Drizzle client backed by Neon's HTTP serverless driver.
 *
 * The /api/psn-deals route runs on the Vercel Edge Runtime, where node-postgres
 * (`pg`) cannot open TCP sockets. `@neondatabase/serverless` ships SQL-over-HTTP,
 * which works from both Edge and Node. Everything here is lazy — importing this
 * module never throws, only calling getEdgeDb() without DATABASE_URL does, so
 * callers can degrade gracefully (localStorage watchlist / honest outage).
 *
 * The Node runtime keeps using src/db/index.ts (pg Pool) for the library module.
 */

import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

// Local development / integration testing: point the Neon HTTP driver at a
// compatible local endpoint (Neon proxy or mock). Inert unless explicitly set —
// production uses the default Neon endpoint derived from DATABASE_URL.
const fetchEndpoint = process.env.NEON_FETCH_ENDPOINT?.trim();
if (fetchEndpoint) {
  neonConfig.fetchEndpoint = fetchEndpoint;
}

type EdgeDb = ReturnType<typeof createEdgeDb>;

const createEdgeDb = () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return drizzle(neon(url));
};

let cached: EdgeDb | null = null;

export function getEdgeDb(): EdgeDb {
  if (!cached) {
    cached = createEdgeDb();
  }
  return cached;
}
