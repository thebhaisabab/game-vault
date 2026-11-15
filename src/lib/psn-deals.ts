/**
 * Server-side data layer for /psn-deals.
 *
 *   - FX: open.er-api.com (free, keyless) with a 10-minute in-memory cache and
 *     a labelled offline fallback.
 *   - PSN Turkey game deals: best-effort live scrape of the public PSN Store
 *     page (embedded Next.js payload). Sony exposes no official keyless API,
 *     and the payload shape is undocumented, so this is intentionally
 *     defensive; on ANY failure we return the bundled snapshot, clearly
 *     labelled as an offline snapshot rather than live data.
 *   - Worldwide console board: curated snapshot from psn-deals-data.ts.
 */

import {
  CONSOLE_DEALS,
  FX_FALLBACK,
  TURKEY_SNAPSHOT_AS_OF,
  TURKEY_SNAPSHOT_GAMES,
  withDiscount,
  type ConsoleDeal,
  type FxRates,
  type PsnDealGame,
} from "./psn-deals-data";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// ------------------------------------------------------------ FX rates ----

let fxCache: { value: FxRates; expiresAt: number } | undefined;

export async function getFxRates(): Promise<FxRates> {
  if (fxCache && fxCache.expiresAt > Date.now()) return fxCache.value;
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/TRY", {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`FX provider failed (${res.status})`);
    const data = (await res.json()) as {
      result?: string;
      rates?: Record<string, number>;
      time_last_update_utc?: string;
    };
    const bdtPerTry = data.rates?.BDT;
    if (data.result !== "success" || !bdtPerTry || !Number.isFinite(bdtPerTry)) {
      throw new Error("FX provider returned no BDT rate");
    }
    const value: FxRates = {
      bdtPerTry,
      tryPerBdt: 1 / bdtPerTry,
      asOf: data.time_last_update_utc ?? new Date().toISOString(),
      source: "live",
    };
    fxCache = { value, expiresAt: Date.now() + 10 * 60 * 1000 };
    return value;
  } catch (err) {
    console.error("[psn-deals] FX fetch failed, using offline estimate:", err);
    const value: FxRates = { ...FX_FALLBACK };
    fxCache = { value, expiresAt: Date.now() + 60 * 1000 };
    return value;
  }
}

// ------------------------------------------------- PSN Turkey game deals --

export interface TurkeyDealsResult {
  games: PsnDealGame[];
  source: "live" | "snapshot";
  asOf: string | null;
}

const normTitle = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, "");

const toNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    // handles "2449", "2.449,00", "₺2.449,00", "2449.00"
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

const looksLikePricedProduct = (
  rec: Record<string, unknown>,
): boolean => {
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
  if (base == null || sale == null) return false;
  if (base <= 0 || sale <= 0 || sale >= base) return false;
  return true;
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

const productToDeal = (rec: Record<string, unknown>): PsnDealGame | null => {
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
  // Normalise minor units (cents/kuruş) if values look like them.
  if (base >= 100_000) {
    base = base / 100;
    sale = (sale ?? 0) / 100;
  }
  base = Math.round(base);
  sale = Math.round(sale);
  if (base <= 0 || sale <= 0 || sale >= base) return null;
  const discountPct = Math.min(
    95,
    Math.max(1, Math.round((1 - sale / base) * 100)),
  );
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

async function fetchTurkeyDealsLive(): Promise<PsnDealGame[]> {
  const res = await fetch("https://store.playstation.com/tr-tr/promotions", {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
    },
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PSN TR promotions page failed (${res.status})`);
  const html = await res.text();
  const match = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match?.[1]) throw new Error("PSN page had no embedded __NEXT_DATA__");
  const payload: unknown = JSON.parse(match[1]);

  const seen = new Set<string>();
  const deals: PsnDealGame[] = [];
  for (const node of walkJson(payload, { left: 250_000 })) {
    const deal = productToDeal(node);
    if (!deal) continue;
    const key = normTitle(deal.title);
    if (seen.has(key)) continue;
    seen.add(key);
    deals.push(deal);
    if (deals.length >= 60) break;
  }
  if (deals.length < 4) {
    throw new Error(`PSN page parsed only ${deals.length} products`);
  }
  return deals.sort((a, b) => b.discountPct - a.discountPct);
}

export async function getTurkeyDeals(): Promise<TurkeyDealsResult> {
  try {
    const games = await fetchTurkeyDealsLive();
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

export function getConsoleDeals(): ConsoleDeal[] {
  return CONSOLE_DEALS;
}
