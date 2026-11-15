/**
 * Server-side data layer for /psn-deals.
 *
 *   - FX: open.er-api.com (free, keyless, USD-based table) with a 30-minute
 *     Next.js data cache and an in-memory fallback, plus a labelled offline
 *     estimate if every rate source fails. One call yields BDT rates for
 *     USD, GBP, EUR, JPY and TRY.
 *   - PSN Turkey game deals: live via Sony's PlayStation Store. Two keyless
 *     strategies, in order:
 *       1. web.np.playstation.com GraphQL persisted query (opt-in: set
 *          PSN_TR_DEALS_HASH — the hash is undocumented/rotating, so it is
 *          read from the environment, never hardcoded). Requested with a
 *          browser UA, tr-TR Accept-Language and x-psn-store-locale-override.
 *       2. The public promotions page's embedded __NEXT_DATA__ payload,
 *          walked defensively for priced products.
 *     On any failure we return the bundled snapshot, clearly labelled.
 *   - PSN TR catalog search (watchlist lookup): same __NEXT_DATA__ walker
 *     against the public search page; returns full-price and discounted items.
 *   - Worldwide console board: best-effort live JSON-LD offers from
 *     PlayStation Direct regional storefronts (USA/UK/Europe); regions
 *     without PS Direct (JP, TR) and any failed fetch fall back to a curated
 *     row that is labelled per-row as CURATED. Quick-link buttons always
 *     work regardless of live results.
 *
 * All functions accept { force: true } (from ?refresh=1) to bypass every
 * cache. `revalidate` on the route and on fetches is 30 minutes elsewhere.
 */

import {
  CONSOLE_DEALS,
  FX_FALLBACK,
  TURKEY_SNAPSHOT_AS_OF,
  TURKEY_SNAPSHOT_GAMES,
  withDiscount,
  type ConsoleCurrency,
  type ConsoleDeal,
  type EnrichedConsoleDeal,
  type FxRates,
  type PsnDealGame,
} from "./psn-deals-data";

export const REVALIDATE_SECONDS = 1800; // 30 minutes

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const TR_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
  "x-psn-store-locale-override": "tr-TR",
} as const;

export interface FetchOpts {
  force?: boolean;
}

const fetchInit = (force: boolean | undefined) =>
  force
    ? ({ cache: "no-store" } as const)
    : ({ next: { revalidate: REVALIDATE_SECONDS } } as const);

// Module-level bookkeeping (per server instance): timestamps of the last
// successful LIVE fetches, exposed in the API payload so the UI can show them.
const lastLive = { gamesAt: null as number | null, consolesAt: null as number | null, fxAt: null as number | null };

export const liveMeta = () => ({
  lastLiveGamesAt: lastLive.gamesAt ? new Date(lastLive.gamesAt).toISOString() : null,
  lastLiveConsolesAt: lastLive.consolesAt ? new Date(lastLive.consolesAt).toISOString() : null,
  lastLiveFxAt: lastLive.fxAt ? new Date(lastLive.fxAt).toISOString() : null,
});

// ------------------------------------------------------------ FX rates ----

let fxCache: { value: FxRates; expiresAt: number } | undefined;

export async function getFxRates({ force }: FetchOpts = {}): Promise<FxRates> {
  if (!force && fxCache && fxCache.expiresAt > Date.now()) {
    return fxCache.value;
  }
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8000),
      ...fetchInit(force),
    });
    if (!res.ok) throw new Error(`FX provider failed (${res.status})`);
    const data = (await res.json()) as {
      result?: string;
      rates?: Record<string, number>;
      time_last_update_utc?: string;
    };
    const rates = data.rates;
    const bdt = rates?.BDT;
    if (data.result !== "success" || !bdt || !Number.isFinite(bdt)) {
      throw new Error("FX provider returned no BDT rate");
    }
    const per = (c: ConsoleCurrency) => {
      const r = rates?.[c];
      // Missing currency? Fall back to the offline estimate for just that
      // currency instead of failing the whole FX fetch.
      return r && Number.isFinite(r) ? bdt / r : FX_FALLBACK.bdtRates[c];
    };
    const bdtRates: Record<ConsoleCurrency, number> = {
      USD: bdt,
      GBP: per("GBP"),
      EUR: per("EUR"),
      JPY: per("JPY"),
      TRY: per("TRY"),
    };
    const value: FxRates = {
      bdtPerTry: bdtRates.TRY,
      tryPerBdt: 1 / bdtRates.TRY,
      bdtRates,
      asOf: data.time_last_update_utc ?? new Date().toISOString(),
      source: "live",
    };
    lastLive.fxAt = Date.now();
    fxCache = { value, expiresAt: Date.now() + REVALIDATE_SECONDS * 1000 };
    return value;
  } catch (err) {
    console.error("[psn-deals] FX fetch failed, using offline estimate:", err);
    const value: FxRates = { ...FX_FALLBACK };
    if (!force) fxCache = { value, expiresAt: Date.now() + 60 * 1000 };
    return value;
  }
}

// --------------------------------------------- PSN TR pricing utilities --

const normTitle = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, "");

const toNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "");
    const n = Number.parseFloat(cleaned.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const priceValue = (
  obj: Record<string, unknown>,
  keys: string[],
): number | null => {
  for (const key of keys) {
    const v = obj[key];
    if (v == null) continue;
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const n = toNumber(v);
      if (n != null) return n;
      continue;
    }
    if (typeof v === "object") {
      const rec = v as Record<string, unknown>;
      const n =
        toNumber(rec.value) ?? toNumber(rec.amount) ?? toNumber(rec.raw);
      if (n != null) return n;
    }
  }
  return null;
};

const pickString = (
  obj: Record<string, unknown>,
  keys: string[],
): string | null => {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
};

const looksLikePricedProduct = (rec: Record<string, unknown>): boolean => {
  const name = pickString(rec, ["localName", "name", "title"]);
  if (!name || name.length < 2 || name.length > 160) return false;
  const base = priceValue(rec, ["basePrice", "originalPrice", "fullPrice"]);
  const sale = priceValue(rec, [
    "discountedPrice",
    "discountPrice",
    "salePrice",
    "currentPrice",
    "price",
  ]);
  return base != null && sale != null && base > 0 && sale > 0 && sale <= base;
};

function* walkJson(
  node: unknown,
  budget: { left: number },
  depth = 0,
): Generator<Record<string, unknown>> {
  if (depth > 16 || budget.left <= 0 || node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) {
      if (budget.left <= 0) return;
      yield* walkJson(item, budget, depth + 1);
    }
    return;
  }
  if (typeof node !== "object") return;
  const rec = node as Record<string, unknown>;
  budget.left -= 1;
  if (looksLikePricedProduct(rec)) {
    yield rec;
    return;
  }
  for (const v of Object.values(rec)) {
    if (budget.left <= 0) return;
    yield* walkJson(v, budget, depth + 1);
  }
}

const djb2 = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
};

const pickImage = (rec: Record<string, unknown>): string | null => {
  const direct = pickString(rec, ["imageUrl", "unsanitized_image_url", "image"]);
  if (direct && direct.startsWith("http")) return direct;
  const media = rec.media;
  if (Array.isArray(media)) {
    for (const entry of media) {
      if (entry && typeof entry === "object") {
        const url = pickString(entry as Record<string, unknown>, ["url", "imageUrl"]);
        if (url && url.startsWith("http")) return url;
      }
    }
  }
  return null;
};

const productToDeal = (
  rec: Record<string, unknown>,
  { requireDiscount }: { requireDiscount: boolean },
): PsnDealGame | null => {
  const title = pickString(rec, ["localName", "name", "title"]);
  if (!title) return null;
  let base = priceValue(rec, ["basePrice", "originalPrice", "fullPrice"]);
  let sale = priceValue(rec, [
    "discountedPrice",
    "discountPrice",
    "salePrice",
    "currentPrice",
    "price",
  ]);
  if (base == null || sale == null) return null;
  // Normalise minor units (kuruş/cents) if values look like them.
  if (base >= 100_000) {
    base = base / 100;
    sale = (sale ?? 0) / 100;
  }
  base = Math.round(base);
  sale = Math.round(sale);
  if (base <= 0 || sale <= 0 || sale > base) return null;
  const discountPct = Math.min(
    95,
    Math.max(0, Math.round((1 - sale / base) * 100)),
  );
  if (requireDiscount && discountPct < 1) return null;
  const probe = JSON.stringify(rec).slice(0, 3000);
  const hasPs5 = /ps5|playstation\s*5/i.test(probe);
  const hasPs4 = /ps4|playstation\s*4/i.test(probe);
  const platforms: Array<"PS5" | "PS4"> =
    hasPs5 && hasPs4 ? ["PS5", "PS4"] : hasPs4 ? ["PS4"] : ["PS5"];
  return {
    id: `psn-live-${djb2(title.toLowerCase())}`,
    title,
    platforms,
    basePrice: base,
    salePrice: sale,
    discountPct,
    coverUrl: pickImage(rec),
    url: `https://store.playstation.com/tr-tr/search/${encodeURIComponent(title)}`,
  };
};

const dedupeByTitle = (
  deals: PsnDealGame[],
  limit: number,
): PsnDealGame[] => {
  const seen = new Set<string>();
  const out: PsnDealGame[] = [];
  for (const d of deals) {
    const key = normTitle(d.title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
    if (out.length >= limit) break;
  }
  return out;
};

const parseNextData = (html: string): unknown => {
  const match = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match?.[1]) throw new Error("page had no embedded __NEXT_DATA__");
  return JSON.parse(match[1]);
};

// -------------------------------------- PSN Turkey live game deal sources --

/**
 * Strategy 1: Sony's PlayStation Store GraphQL persisted query.
 * The sha256 hash is undocumented and rotates; it must be provided via the
 * PSN_TR_DEALS_HASH env var (copy it from DevTools → Network → the
 * categoryGridRetrieve request on store.playstation.com). No hash → skip.
 */
async function fetchTurkeyDealsGraphql(
  { force }: FetchOpts = {},
): Promise<PsnDealGame[] | null> {
  const hash = process.env.PSN_TR_DEALS_HASH;
  if (!hash) return null;
  const res = await fetch(
    "https://web.np.playstation.com/api/graphql/v1/op",
    {
      method: "POST",
      headers: {
        ...TR_HEADERS,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operationName: "categoryGridRetrieve",
        variables: {},
        extensions: {
          persistedQuery: { version: 1, sha256Hash: hash },
        },
      }),
      signal: AbortSignal.timeout(10000),
      ...fetchInit(force),
    },
  );
  if (!res.ok) throw new Error(`PSN GraphQL failed (${res.status})`);
  const payload: unknown = await res.json();
  const deals = dedupeByTitle(
    [...walkJson(payload, { left: 250_000 })]
      .map((node) => productToDeal(node, { requireDiscount: true }))
      .filter((d): d is PsnDealGame => d != null),
    60,
  ).sort((a, b) => b.discountPct - a.discountPct);
  return deals.length >= 4 ? deals : null;
}

/** Strategy 2: public promotions page, embedded __NEXT_DATA__ walker. */
async function fetchTurkeyDealsHtml(
  { force }: FetchOpts = {},
): Promise<PsnDealGame[]> {
  const res = await fetch("https://store.playstation.com/tr-tr/promotions", {
    headers: { ...TR_HEADERS, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(10000),
    ...fetchInit(force),
  });
  if (!res.ok)
    throw new Error(`PSN TR promotions page failed (${res.status})`);
  const payload = parseNextData(await res.text());
  const deals = dedupeByTitle(
    [...walkJson(payload, { left: 250_000 })]
      .map((node) => productToDeal(node, { requireDiscount: true }))
      .filter((d): d is PsnDealGame => d != null),
    60,
  ).sort((a, b) => b.discountPct - a.discountPct);
  if (deals.length < 4) {
    throw new Error(`PSN page parsed only ${deals.length} products`);
  }
  return deals;
}

export interface TurkeyDealsResult {
  games: PsnDealGame[];
  source: "live" | "snapshot";
  asOf: string | null;
}

export async function getTurkeyDeals(
  opts: FetchOpts = {},
): Promise<TurkeyDealsResult> {
  try {
    const games = await fetchTurkeyDealsGraphql(opts);
    if (games) {
      lastLive.gamesAt = Date.now();
      return { games, source: "live", asOf: null };
    }
  } catch (err) {
    console.warn("[psn-deals] GraphQL deals source failed:", err);
  }
  try {
    const games = await fetchTurkeyDealsHtml(opts);
    lastLive.gamesAt = Date.now();
    return { games, source: "live", asOf: null };
  } catch (err) {
    console.error("[psn-deals] Live PSN TR fetch failed, using snapshot:", err);
    return {
      games: TURKEY_SNAPSHOT_GAMES.map(withDiscount),
      source: "snapshot",
      asOf: TURKEY_SNAPSHOT_AS_OF,
    };
  }
}

/**
 * Live catalog search on PSN Turkey — used by the watchlist to price any
 * arbitrary title. Returns full-price AND discounted items.
 */
export async function searchPsnTrLive(
  query: string,
  opts: FetchOpts = {},
): Promise<PsnDealGame[]> {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  const res = await fetch(
    `https://store.playstation.com/tr-tr/search/${encodeURIComponent(q)}`,
    {
      headers: { ...TR_HEADERS, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(10000),
      ...fetchInit(opts.force),
    },
  );
  if (!res.ok) throw new Error(`PSN TR search failed (${res.status})`);
  const payload = parseNextData(await res.text());
  const needle = normTitle(q);
  const deals = [...walkJson(payload, { left: 250_000 })]
    .map((node) => productToDeal(node, { requireDiscount: false }))
    .filter((d): d is PsnDealGame => d != null)
    .filter((d) => normTitle(d.title).includes(needle));
  return dedupeByTitle(deals, 10).sort((a, b) => b.discountPct - a.discountPct);
}

// ------------------------------------------- Worldwide console live lookup --

const schemaOrgAvailability = (v: unknown): ConsoleDeal["availability"] => {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("outofstock") || s.includes("soldout")) return "out_of_stock";
  if (s.includes("limitedavailability")) return "limited";
  if (s.includes("preorder") || s.includes("presale")) return "preorder";
  return "in_stock";
};

const extractJsonLdBlocks = (html: string): unknown[] => {
  const blocks: unknown[] = [];
  for (const m of html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    try {
      blocks.push(JSON.parse(m[1]));
    } catch {
      // ignore malformed JSON-LD blocks
    }
  }
  return blocks;
};

function* findProducts(
  node: unknown,
  depth = 0,
): Generator<Record<string, unknown>> {
  if (depth > 8 || node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) yield* findProducts(item, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const rec = node as Record<string, unknown>;
  const type = rec["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => typeof t === "string" && /product/i.test(t))) {
    yield rec;
    return;
  }
  for (const v of Object.values(rec)) yield* findProducts(v, depth + 1);
};

const offersFrom = (
  product: Record<string, unknown>,
): { price: number; currency: string; availability: ConsoleDeal["availability"] } | null => {
  const offers = Array.isArray(product.offers) ? product.offers : [product.offers];
  for (const offer of offers) {
    if (!offer || typeof offer !== "object") continue;
    const rec = offer as Record<string, unknown>;
    const price = toNumber(rec.price ?? rec.lowPrice);
    const currency = pickString(rec, ["priceCurrency", "currency"]);
    if (price && currency) {
      return {
        price,
        currency: currency.toUpperCase(),
        availability: schemaOrgAvailability(rec.availability),
      };
    }
  }
  return null;
};

/**
 * Live candidates: one PlayStation Direct product page per PS Direct region.
 * Japan and Turkey have no PS Direct storefront, so those rows are always the
 * curated snapshot. Any failure (slug drift, block, missing offer, wrong
 * currency) silently keeps the curated row for that region instead.
 */
const PS_DIRECT_CANDIDATES: ReadonlyArray<{
  rowId: string;
  url: string;
  currency: ConsoleCurrency;
}> = [
  { rowId: "con-us-3", url: "https://direct.playstation.com/en-us/p/playstation-5-pro", currency: "USD" },
  { rowId: "con-uk-3", url: "https://direct.playstation.com/en-gb/p/playstation-5-pro", currency: "GBP" },
  { rowId: "con-eu-3", url: "https://direct.playstation.com/en-de/p/playstation-5-pro", currency: "EUR" },
];

async function fetchLiveConsoleRows(
  { force }: FetchOpts = {},
): Promise<Map<string, ConsoleDeal>> {
  const out = new Map<string, ConsoleDeal>();
  await Promise.allSettled(
    PS_DIRECT_CANDIDATES.map(async ({ rowId, url, currency }) => {
      const res = await fetch(url, {
        headers: { ...TR_HEADERS, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
        signal: AbortSignal.timeout(10000),
        ...fetchInit(force),
      });
      if (!res.ok) throw new Error(`PS Direct ${currency} failed (${res.status})`);
      const html = await res.text();
      for (const block of extractJsonLdBlocks(html)) {
        for (const product of findProducts(block)) {
          const name = pickString(product, ["name"]);
          if (!name || !/ps5|playstation\s*5/i.test(name)) continue;
          const offer = offersFrom(product);
          if (!offer || offer.currency !== currency) continue;
          out.set(rowId, {
            id: rowId,
            name,
            note: "Live price from PlayStation Direct",
            market: currency === "USD" ? "USA" : currency === "GBP" ? "UK" : "Europe",
            currency,
            price: offer.price,
            originalPrice: null,
            discountPct: null,
            retailer: "PlayStation Direct",
            availability: offer.availability,
            url,
          });
        }
      }
    }),
  );
  if (out.size > 0) lastLive.consolesAt = Date.now();
  return out;
}

export interface ConsoleBoardResult {
  rows: EnrichedConsoleDeal[];
  liveCount: number;
}

export async function getConsoleBoard(
  fx: FxRates,
  opts: FetchOpts = {},
): Promise<ConsoleBoardResult> {
  const liveRows = await fetchLiveConsoleRows(opts).catch((err) => {
    console.error("[psn-deals] Console live lookup failed:", err);
    return new Map<string, ConsoleDeal>();
  });

  const merged = CONSOLE_DEALS.map((row) => liveRows.get(row.id) ?? row);
  const rows: EnrichedConsoleDeal[] = merged.map((row) => {
    const rate = fx.bdtRates[row.currency as ConsoleCurrency];
    return {
      ...row,
      bdtPrice: rate && Number.isFinite(rate) ? row.price * rate : null,
      source: liveRows.has(row.id) ? "live" : "curated",
    };
  });
  return { rows, liveCount: liveRows.size };
}
