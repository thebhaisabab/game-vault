/**
 * Server-side data layer for /psn-deals.
 *
 * Keyless live pipeline (designed for datacenter/Vercel egress — no GraphQL,
 * which Sony's edge blocks from serverless IPs):
 *
 *   - FX: open.er-api.com (free, keyless, USD-based table) — one call yields
 *     live BDT rates for USD, GBP, EUR, JPY and TRY. 30-minute Next.js data
 *     cache + in-memory fallback; labelled offline estimate as last resort.
 *   - PSN Turkey game deals (TRY / ₺):
 *       1. PlayStation Store HTML pages —
 *          https://store.playstation.com/en-tr/pages/deals
 *          https://store.playstation.com/tr-tr/category/3f772501-f6f8-49b7-abac-874a88ca4897/1
 *          fetched with full realistic Chrome desktop headers
 *          (User-Agent, Accept text/html, Accept-Language tr-TR, Sec-Fetch-*)
 *          and parsed from the embedded <script id="__NEXT_DATA__"> JSON
 *          (Apollo/cache state walked defensively for priced products).
 *       2. If the store blocks the datacenter IP (HTTP 403 / Akamai) or the
 *          page shape changes, automatically fall back to live aggregators:
 *          https://psprices.com/region-tr/discounts/?platform=PS5,PS4 then
 *          https://psdeals.net/tr-store/discounts — parsed from their
 *          embedded JSON when present, otherwise from raw HTML cards.
 *       3. Only when every live endpoint fails: bundled labelled snapshot.
 *   - Watchlist lookup (?query=): the same chain against
 *          https://store.playstation.com/en-tr/search/<q>
 *          (fallback https://psdeals.net/tr-store/search?search_query=<q>),
 *          returning full-price and discounted items.
 *   - Worldwide console prices: regional PlayStation hardware pages
 *          https://www.playstation.com/{en-us|en-gb|de-de|ja-jp|tr-tr}/ps5/buy-now/
 *          parsed via JSON-LD offers → embedded JSON walk → raw currency
 *          regex scrape (per-currency sanity bounds, model-classified
 *          Slim/Digital/Pro). PlayStation Direct JSON-LD is the fallback for
 *          PS Direct regions (US/UK/DE). Anything that fails its sanity
 *          checks keeps the Nov-2026 curated baseline, labelled per-row.
 *          Every row is converted to ৳ BDT at the live FX rate.
 *
 * All fetches accept { force: true } (from ?refresh=1) to bypass caches.
 * Every live path is labelled with its provider + exact fetch timestamp in
 * the API payload; nothing is silently faked as live.
 */

import {
  ALL_DEALS_CATEGORY,
  CONSOLE_DEALS,
  FX_FALLBACK,
  type DealCampaign,
  type ConsoleCurrency,
  type ConsoleDeal,
  type EnrichedConsoleDeal,
  type FxRates,
  type PsnDealGame,
} from "./psn-deals-data";

export const REVALIDATE_SECONDS = 1800; // 30 minutes

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Full realistic Chrome desktop navigation headers (tr-TR locale). */
const DESKTOP_HEADERS = {
  "User-Agent": CHROME_UA,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "Cache-Control": "max-age=0",
} as const;

const desktopHeaders = (acceptLanguage: string) => ({
  ...DESKTOP_HEADERS,
  "Accept-Language": acceptLanguage,
});

export interface FetchOpts {
  force?: boolean;
  /** Category UUID to load instead of the default All Deals category. */
  categoryId?: string;
}

const CATEGORY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sanitise a category UUID coming from the client; falls back to All Deals. */
export const sanitizeCategoryId = (value: string | null | undefined): string =>
  value && CATEGORY_ID_RE.test(value) ? value.toLowerCase() : ALL_DEALS_CATEGORY;

const fetchInit = (force: boolean | undefined) =>
  force
    ? ({ cache: "no-store" } as const)
    : ({ next: { revalidate: REVALIDATE_SECONDS } } as const);

// Module-level bookkeeping (per server instance): timestamps + provider
// labels of the last successful LIVE fetches, exposed in the API payload so
// the UI can show "LIVE SOURCE: <provider>" and the exact fetch time.
const lastLive = {
  gamesAt: null as number | null,
  consolesAt: null as number | null,
  fxAt: null as number | null,
  gamesProvider: null as string | null,
  consolesProvider: null as string | null,
};

export const liveMeta = () => ({
  lastLiveGamesAt: lastLive.gamesAt ? new Date(lastLive.gamesAt).toISOString() : null,
  lastLiveConsolesAt: lastLive.consolesAt ? new Date(lastLive.consolesAt).toISOString() : null,
  lastLiveFxAt: lastLive.fxAt ? new Date(lastLive.fxAt).toISOString() : null,
  gamesProvider: lastLive.gamesProvider,
  consolesProvider: lastLive.consolesProvider,
});

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number.parseInt(n, 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    });

/** Parse a localized number, disambiguating en/de thousand & decimal separators. */
const parseLocalizedNumber = (raw: string): number | null => {
  let s = raw.trim().replace(/[^\d.,-]/g, "");
  if (!s) return null;
  // 1.234.567,89 (de/tr) or 1,234,567.89 (en) with explicit thousand groups
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) {
    s = s.replace(/,/g, "");
  } else {
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastDot > lastComma) {
      s = lastComma === -1 && s.length - lastDot - 1 <= 2 ? s : s.replace(/,/g, "");
    } else if (lastComma > lastDot) {
      s =
        s.length - lastComma - 1 <= 2
          ? s.replace(/\./g, "").replace(",", ".")
          : s.replace(/,/g, "");
    }
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

// ------------------------------------------------------------ FX rates ----

let fxCache: { value: FxRates; expiresAt: number } | undefined;

export async function getFxRates({ force }: FetchOpts = {}): Promise<FxRates> {
  if (!force && fxCache && fxCache.expiresAt > Date.now()) {
    return fxCache.value;
  }
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      headers: { Accept: "application/json", "User-Agent": CHROME_UA },
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

const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");

const toNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseLocalizedNumber(v);
    return n;
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

/** Banner image for a campaign object: explicit banner keys first, media arrays second. */
const pickBannerImage = (rec: Record<string, unknown>): string | null => {
  const banner = pickString(rec, [
    "bannerImage",
    "banner",
    "coverImage",
    "imageUrl",
    "image",
    "thumbnail",
  ]);
  if (banner && banner.startsWith("http")) return banner;
  return pickImage(rec);
};

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

const PLATFORM_RE = /ps\s*5/i;

const platformOf = (probe: string): Array<"PS5" | "PS4"> => {
  const hasPs5 = PLATFORM_RE.test(probe) || /playstation\s*5/i.test(probe);
  const hasPs4 = /ps\s*4/i.test(probe) || /playstation\s*4/i.test(probe);
  if (hasPs5 && hasPs4) return ["PS5", "PS4"];
  if (hasPs4) return ["PS4"];
  return ["PS5"];
};

/** PSN catalog product id, e.g. "UP0001-PPSA01234_00-ABCDEF1234567890". */
const pickProductId = (rec: Record<string, unknown>): string | null => {
  for (const key of ["id", "productId", "commerceProductId", "namespaceId"]) {
    const v = rec[key];
    if (
      typeof v === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9_-]{9,63}$/.test(v) &&
      /\d/.test(v)
    ) {
      return v;
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
  if (base > 200_000 || sale < 10) return null;
  const discountPct = Math.min(
    95,
    Math.max(0, Math.round((1 - sale / base) * 100)),
  );
  if (requireDiscount && discountPct < 1) return null;
  const probe = JSON.stringify(rec).slice(0, 3000);
  const productId = pickProductId(rec);
  return {
    id: productId ?? `psn-live-${djb2(title.toLowerCase())}`,
    title,
    platforms: platformOf(probe),
    basePrice: base,
    salePrice: sale,
    discountPct,
    coverUrl: pickImage(rec),
    url: productId
      ? `https://store.playstation.com/en-tr/product/${encodeURIComponent(productId)}`
      : `https://store.playstation.com/en-tr/search/${encodeURIComponent(title)}`,
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

const parseNextData = (html: string): unknown | null => {
  const match = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
};

const walkerDeals = (
  payload: unknown,
  requireDiscount: boolean,
  limit: number,
): PsnDealGame[] =>
  dedupeByTitle(
    [...walkJson(payload, { left: 250_000 })]
      .map((node) => productToDeal(node, { requireDiscount }))
      .filter((d): d is PsnDealGame => d != null),
    limit,
  ).sort((a, b) => b.discountPct - a.discountPct);

// --------------------------------------- Raw-card HTML parser (aggregators) --

const TRY_TOKEN =
  /(?:₺\s*([\d][\d.,]*))|(?:TL\s*([\d][\d.,]*))|(?:([\d][\d.,]*)\s*(?:₺|TL))/g;

/** Sanity window for a PSN TR game price (₺). */
const TRY_MIN = 10;
const TRY_MAX = 200_000;

const parseTryTokens = (chunk: string): number[] => {
  const out: number[] = [];
  for (const m of chunk.matchAll(TRY_TOKEN)) {
    const raw = m[1] ?? m[2] ?? m[3];
    if (!raw) continue;
    const n = toNumber(raw);
    if (n != null && n >= TRY_MIN && n <= TRY_MAX) out.push(Math.round(n));
  }
  return out;
};

const stripTags = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** Extract game cards (anchor blocks) from raw HTML of an aggregator page. */
const parseHtmlCards = (
  html: string,
  origin: string,
  { requireDiscount }: { requireDiscount: boolean },
): PsnDealGame[] => {
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  const deals: PsnDealGame[] = [];
  const anchorRe = /<a\s[^>]*href="([^"#][^"]*)"[^>]*>([\s\S]{20,4000}?)<\/a>/gi;
  for (const match of clean.matchAll(anchorRe)) {
    const [, href, inner] = match;
    const prices = parseTryTokens(inner);
    if (prices.length === 0) continue;
    const sale = Math.min(...prices);
    const base = Math.max(...prices);
    if (base <= 0 || sale > base) continue;
    const discountMatch = inner.match(/-?\s*(\d{1,2})\s*%/);
    const discountPct = Math.min(
      95,
      Math.max(
        0,
        discountMatch
          ? Number.parseInt(discountMatch[1], 10)
          : Math.round((1 - sale / base) * 100),
      ),
    );
    if (requireDiscount && discountPct < 1) continue;
    const text = stripTags(inner);
    const altMatch = inner.match(/alt="([^"]{3,140})"/i);
    const headingMatch = inner.match(/<h[1-6][^>]*>([^<]{3,140})<\/h[1-6]>/i);
    const title = decodeEntities(
      (headingMatch?.[1] ?? altMatch?.[1] ?? "").trim(),
    );
    if (!title || title.length < 3) continue;
    if (!/[a-z0-9]/i.test(title)) continue;
    const imgMatch = inner.match(/<img[^>]+(?:data-src|src)="([^"]+)"/i);
    const coverUrl = imgMatch?.[1]?.startsWith("http")
      ? imgMatch[1]
      : imgMatch?.[1]
        ? `${origin}${imgMatch[1].startsWith("/") ? "" : "/"}${imgMatch[1]}`
        : null;
    const url = href.startsWith("http")
      ? href
      : `${origin}${href.startsWith("/") ? "" : "/"}${href}`;
    deals.push({
      id: `psn-live-${djb2(title.toLowerCase())}`,
      title,
      platforms: platformOf(text),
      basePrice: base,
      salePrice: sale,
      discountPct,
      coverUrl,
      url,
    });
  }
  return dedupeByTitle(deals, 60).sort((a, b) => b.discountPct - a.discountPct);
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

/** Best-effort deals from an aggregator page: embedded JSON first, then raw HTML cards. */
const aggregatorDeals = (
  html: string,
  origin: string,
  { requireDiscount }: { requireDiscount: boolean },
): PsnDealGame[] => {
  const nextData = parseNextData(html);
  if (nextData) {
    const fromWalker = walkerDeals(nextData, requireDiscount, 60);
    if (fromWalker.length >= 4) return fromWalker;
  }
  const fromLd: PsnDealGame[] = [];
  for (const block of extractJsonLdBlocks(html)) {
    fromLd.push(...walkerDeals(block, requireDiscount, 60));
  }
  const mergedLd = dedupeByTitle(fromLd, 60);
  if (mergedLd.length >= 4) return mergedLd;
  return parseHtmlCards(html, origin, { requireDiscount });
};

// -------------------------------------- PSN Turkey live game deal sources --

const PSN_DEALS_PAGE = "https://store.playstation.com/en-tr/pages/deals";
const psnCategoryUrl = (categoryId: string) =>
  `https://store.playstation.com/en-tr/category/${categoryId}/1`;

const PSN_SEARCH_URL = (q: string) =>
  `https://store.playstation.com/en-tr/search/${encodeURIComponent(q)}`;

/** Deals-hub requests per spec: en-TR locale on the English TR storefront. */
const PSN_TR_HEADERS = () => desktopHeaders("en-TR,en;q=0.9,tr;q=0.8");

const AGGREGATORS = [
  {
    id: "psdeals.net",
    url: "https://psdeals.net/tr-store/discounts",
    origin: "https://psdeals.net",
  },
  {
    id: "psprices.com",
    url: "https://psprices.com/region-tr/discounts/?platform=PS5,PS4",
    origin: "https://psprices.com",
  },
] as const;
const PSDEALS_SEARCH_URL = (q: string) =>
  `https://psdeals.net/tr-store/search?search_query=${encodeURIComponent(q)}`;

export interface TurkeyDealsResult {
  games: PsnDealGame[];
  source: "live" | "unavailable";
  /** Provider hostname when source === "live" (e.g. "store.playstation.com"). */
  provider: string | null;
  /** Always null — no offline snapshot exists; kept for API compatibility. */
  asOf: null;
}

/** Strategy 1: PlayStation Store HTML pages with full Chrome desktop headers. */
async function fetchTurkeyDealsPsnPages(
  { force, categoryId }: FetchOpts = {},
): Promise<PsnDealGame[] | null> {
  const category = sanitizeCategoryId(categoryId);
  const pages = [PSN_DEALS_PAGE, psnCategoryUrl(category)];
  const results = await Promise.allSettled(
    pages.map(async (url) => {
      const res = await fetch(url, {
        headers: PSN_TR_HEADERS(),
        signal: AbortSignal.timeout(12000),
        ...fetchInit(force),
      });
      if (!res.ok) {
        throw new Error(`${url} → HTTP ${res.status} (possible Akamai/IP block)`);
      }
      const html = await res.text();
      const nextData = parseNextData(html);
      if (!nextData) throw new Error(`${url} had no parseable __NEXT_DATA__`);
      return walkerDeals(nextData, true, 60);
    }),
  );
  const merged: PsnDealGame[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") merged.push(...r.value);
    else console.warn("[psn-deals] PSN deal page failed:", r.reason);
  }
  const games = dedupeByTitle(merged, 60).sort(
    (a, b) => b.discountPct - a.discountPct,
  );
  return games.length >= 4 ? games : null;
}

// --------------------------------------- Deal-campaign (pill) extraction --

const CAMPAIGN_SOUNDLIKE_SKIP = /[₺$€£¥]|\d{3,}/;

/**
 * Walk the deals-hub page and collect the campaign/collection banners it
 * advertises (e.g. "All Deals", "Black Friday", "Games for Less"). A campaign
 * is an OBJECT that references a category UUID and carries a human title, but
 * is NOT itself a priced product (games embed the same UUID in their own
 * payloads — those are excluded).
 */
const extractCampaigns = (payload: unknown): DealCampaign[] => {
  const found = new Map<string, DealCampaign>();
  const stack: unknown[] = [payload];
  let steps = 0;
  const uuidRe =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  while (stack.length > 0 && steps < 150_000) {
    steps += 1;
    const node = stack.pop();
    if (node == null) continue;
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (typeof node !== "object") continue;
    const rec = node as Record<string, unknown>;
    const rawTitle = pickString(rec, [
      "name",
      "title",
      "localName",
      "label",
      "headline",
      "text",
    ]);
    const uuids = new Set<string>();
    for (const v of Object.values(rec)) {
      if (typeof v !== "string") continue;
      for (const m of v.matchAll(uuidRe)) uuids.add(m[0].toLowerCase());
    }
    if (uuids.size > 0 && rawTitle && !looksLikePricedProduct(rec)) {
      const title = decodeEntities(rawTitle).replace(/\s+/g, " ").trim();
      if (
        title.length >= 3 &&
        title.length <= 60 &&
        /[a-z]/i.test(title) &&
        !CAMPAIGN_SOUNDLIKE_SKIP.test(title)
      ) {
        const banner = pickBannerImage(rec);
        for (const id of uuids) {
          if (!found.has(id)) found.set(id, { id, title, imageUrl: banner });
        }
      }
    }
    stack.push(...Object.values(rec));
  }
  // Pin "All Deals" first; the deals page order follows otherwise.
  found.delete(ALL_DEALS_CATEGORY.toLowerCase());
  const allDeals: DealCampaign = {
    id: ALL_DEALS_CATEGORY.toLowerCase(),
    title: "All Deals",
    imageUrl: null,
  };
  return [allDeals, ...[...found.values()].slice(0, 11)];
};

let campaignsCache: { value: DealCampaign[]; expiresAt: number } | undefined;

/**
 * Active deal-campaign pills from the TR deals hub. Always includes
 * "All Deals"; on any failure returns just that one pill.
 */
export async function getDealCampaigns(
  { force }: FetchOpts = {},
): Promise<DealCampaign[]> {
  if (!force && campaignsCache && campaignsCache.expiresAt > Date.now()) {
    return campaignsCache.value;
  }
  const allDeals: DealCampaign = {
    id: ALL_DEALS_CATEGORY.toLowerCase(),
    title: "All Deals",
    imageUrl: null,
  };
  try {
    const res = await fetch(PSN_DEALS_PAGE, {
      headers: PSN_TR_HEADERS(),
      signal: AbortSignal.timeout(12000),
      ...fetchInit(force),
    });
    if (!res.ok) throw new Error(`${PSN_DEALS_PAGE} → HTTP ${res.status}`);
    const nextData = parseNextData(await res.text());
    if (!nextData) throw new Error("deals page had no parseable __NEXT_DATA__");
    const campaigns = extractCampaigns(nextData);
    campaignsCache = { value: campaigns, expiresAt: Date.now() + REVALIDATE_SECONDS * 1000 };
    return campaigns;
  } catch (err) {
    console.warn("[psn-deals] deal-campaign extraction failed:", err);
    if (!force) campaignsCache = { value: [allDeals], expiresAt: Date.now() + 5 * 60 * 1000 };
    return [allDeals];
  }
}

/** Strategy 2: live aggregators (psprices.com → psdeals.net). */
async function fetchTurkeyDealsAggregators(
  { force }: FetchOpts = {},
): Promise<{ games: PsnDealGame[]; provider: string } | null> {
  for (const source of AGGREGATORS) {
    try {
      const res = await fetch(source.url, {
        headers: PSN_TR_HEADERS(),
        signal: AbortSignal.timeout(12000),
        ...fetchInit(force),
      });
      if (!res.ok) throw new Error(`${source.id} → HTTP ${res.status}`);
      const html = await res.text();
      const games = aggregatorDeals(html, source.origin, {
        requireDiscount: true,
      });
      if (games.length >= 4) return { games, provider: source.id };
      console.warn(`[psn-deals] ${source.id} parsed only ${games.length} cards`);
    } catch (err) {
      console.warn(`[psn-deals] aggregator ${source.id} failed:`, err);
    }
  }
  return null;
}

export async function getTurkeyDeals(
  opts: FetchOpts = {},
): Promise<TurkeyDealsResult> {
  // 1) PlayStation Store pages (en-tr deals hub + selected category grid)
  try {
    const games = await fetchTurkeyDealsPsnPages(opts);
    if (games) {
      lastLive.gamesAt = Date.now();
      lastLive.gamesProvider = "store.playstation.com";
      return { games, source: "live", provider: "store.playstation.com", asOf: null };
    }
  } catch (err) {
    console.error("[psn-deals] PlayStation Store deals fetch failed:", err);
  }
  // 2) Live aggregators (Akamai/IP-block fallback)
  try {
    const agg = await fetchTurkeyDealsAggregators(opts);
    if (agg) {
      lastLive.gamesAt = Date.now();
      lastLive.gamesProvider = agg.provider;
      return { games: agg.games, source: "live", provider: agg.provider, asOf: null };
    }
  } catch (err) {
    console.error("[psn-deals] aggregator deals fetch failed:", err);
  }
  // 3) NO offline snapshot — report the outage honestly.
  console.error("[psn-deals] All live PSN TR sources failed — deals unavailable.");
  return { games: [], source: "unavailable", provider: null, asOf: null };
}

/**
 * Live catalog lookup for one title — used by the watchlist to price it in
 * TRY. Returns full-price AND discounted items, with the provider label.
 */
export interface CatalogSearchResult {
  results: PsnDealGame[];
  provider: string | null;
}

export async function searchPsnTrLive(
  query: string,
  opts: FetchOpts = {},
): Promise<CatalogSearchResult> {
  const q = query.trim().slice(0, 80);
  const needle = normTitle(q);
  if (q.length < 2) return { results: [], provider: null };

  // 1) PlayStation Store search page
  try {
    const res = await fetch(PSN_SEARCH_URL(q), {
      headers: PSN_TR_HEADERS(),
      signal: AbortSignal.timeout(12000),
      ...fetchInit(opts.force),
    });
    if (!res.ok) throw new Error(`PSN TR search → HTTP ${res.status}`);
    const nextData = parseNextData(await res.text());
    if (!nextData) throw new Error("PSN TR search page had no __NEXT_DATA__");
    const results = dedupeByTitle(
      walkerDeals(nextData, false, 25).filter((d) =>
        normTitle(d.title).includes(needle),
      ),
      10,
    ).sort((a, b) => b.discountPct - a.discountPct);
    return { results, provider: "store.playstation.com" };
  } catch (err) {
    console.warn("[psn-deals] PSN TR search failed, trying psdeals.net:", err);
  }

  // 2) psdeals.net search fallback
  const res = await fetch(PSDEALS_SEARCH_URL(q), {
    headers: PSN_TR_HEADERS(),
    signal: AbortSignal.timeout(12000),
    ...fetchInit(opts.force),
  });
  if (!res.ok) throw new Error(`psdeals.net search → HTTP ${res.status}`);
  const html = await res.text();
  const results = aggregatorDeals(html, "https://psdeals.net", {
    requireDiscount: false,
  })
    .filter((d) => normTitle(d.title).includes(needle))
    .sort((a, b) => b.discountPct - a.discountPct);
  return { results: results.slice(0, 10), provider: "psdeals.net" };
}

// ------------------------------------------- Worldwide console live lookup --

const schemaOrgAvailability = (v: unknown): ConsoleDeal["availability"] => {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("outofstock") || s.includes("soldout")) return "out_of_stock";
  if (s.includes("limitedavailability")) return "limited";
  if (s.includes("preorder") || s.includes("presale")) return "preorder";
  return "in_stock";
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
}

const offersFrom = (
  product: Record<string, unknown>,
): {
  price: number;
  currency: string;
  availability: ConsoleDeal["availability"];
} | null => {
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

type ModelClass = "slim-disc" | "slim-digital" | "pro";

interface LiveOffer {
  model: ModelClass;
  price: number;
  currency: ConsoleCurrency;
  availability: ConsoleDeal["availability"] | null;
  name: string | null;
}

const MODEL_ROW_ID: Record<string, Record<ModelClass, string>> = {
  USA: { "slim-disc": "con-us-1", "slim-digital": "con-us-2", pro: "con-us-3" },
  UK: { "slim-disc": "con-uk-1", "slim-digital": "con-uk-2", pro: "con-uk-3" },
  Europe: { "slim-disc": "con-eu-1", "slim-digital": "con-eu-2", pro: "con-eu-3" },
  Japan: { "slim-disc": "con-jp-1", "slim-digital": "con-jp-2", pro: "con-jp-3" },
  Turkey: { "slim-disc": "con-tr-1", "slim-digital": "con-tr-2", pro: "con-tr-3" },
};

const SANITY: Record<ConsoleCurrency, { min: number; max: number }> = {
  USD: { min: 250, max: 2500 },
  GBP: { min: 250, max: 2000 },
  EUR: { min: 250, max: 2500 },
  JPY: { min: 40_000, max: 250_000 },
  TRY: { min: 15_000, max: 250_000 },
};

const modelFromText = (text: string): ModelClass | null => {
  if (!/ps\s*5|playstation\s*5/i.test(text)) return null;
  // Model mentions appear in product names, prices come right after the name.
  // When several are in scope, trust the one CLOSEST to the price (the last).
  let best: { idx: number; model: ModelClass } | null = null;
  for (const m of text.matchAll(/pro\b|digital/gi)) {
    const model = /^pro/i.test(m[0]) ? "pro" : "slim-digital";
    if (!best || (m.index ?? 0) > best.idx) best = { idx: m.index ?? 0, model };
  }
  return best?.model ?? "slim-disc"; // unqualified "PS5" ⇒ disc Slim
};

const CURRENCY_REGEX: Record<ConsoleCurrency, RegExp> = {
  USD: /\$\s*([\d]{2,4}(?:[.,]\d{2})?)/g,
  GBP: /£\s*([\d]{2,4}(?:[.,]\d{2})?)/g,
  EUR: /(?:€\s*([\d]{2,4}(?:[.,]\d{2})?)|([\d]{2,4}(?:[.,]\d{2})?)\s*€)/g,
  JPY: /(?:¥\s*([\d]{1,3}(?:[.,][\d]{3})+|[\d]{4,7})|([\d]{1,3}(?:[.,][\d]{3})+|[\d]{4,7})\s*円)/g,
  TRY: /(?:₺\s*([\d]{1,3}(?:[.,][\d]{3})*(?:[.,]\d{1,2})?|[\d]{4,7})|([\d]{1,3}(?:[.,][\d]{3})*(?:[.,]\d{1,2})?|[\d]{4,7})\s*(?:₺|TL))/g,
};

/** OpenGraph product meta — only meaningful on single-product pages. */
const metaContent = (html: string, key: string): string | null => {
  const tagRe = new RegExp(
    `<meta[^>]+(?:property|name|itemprop)="${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`,
    "i",
  );
  const tag = html.match(tagRe)?.[0];
  if (!tag) return null;
  return tag.match(/content="([^"]*)"/i)?.[1]?.trim() ?? null;
};

const offersFromOpenGraph = (
  html: string,
  currency: ConsoleCurrency,
): LiveOffer | null => {
  const priceRaw =
    metaContent(html, "product:price:amount") ??
    metaContent(html, "og:price:amount") ??
    metaContent(html, "product:sale_price:amount") ??
    metaContent(html, "og:price:price");
  const cur = (
    metaContent(html, "product:price:currency") ??
    metaContent(html, "og:price:currency") ??
    metaContent(html, "product:sale_price:currency") ??
    ""
  ).toUpperCase();
  const price = priceRaw ? toNumber(priceRaw) : null;
  if (price == null || cur !== currency || !inBounds(price, currency)) return null;
  const snapped =
    currency === "JPY" || currency === "TRY"
      ? Math.round(price)
      : Math.round(price * 100) / 100;
  const model = modelFromText(html.slice(0, 4000)) ?? "pro";
  return { model, price: snapped, currency, availability: null, name: null };
};

/** Pass 1: JSON-LD Product nodes with offers. */
const offersFromJsonLd = (
  html: string,
  currency: ConsoleCurrency,
): LiveOffer[] => {
  const out: LiveOffer[] = [];
  for (const block of extractJsonLdBlocks(html)) {
    for (const product of findProducts(block)) {
      const name = pickString(product, ["name"]) ?? "";
      const model = modelFromText(name);
      if (!model) continue;
      const offer = offersFrom(product);
      if (!offer || offer.currency !== currency) continue;
      if (!inBounds(offer.price, currency)) continue;
      out.push({
        model,
        price: offer.price,
        currency,
        availability: offer.availability,
        name,
      });
    }
  }
  return out;
};

const inBounds = (price: number, currency: ConsoleCurrency) => {
  const { min, max } = SANITY[currency];
  return price >= min && price <= max;
};

/**
 * Pass 2: embedded JSON (`__NEXT_DATA__` / application/json scripts).
 * Collects objects that mention PS5 and carry a numeric price field.
 */
const offersFromEmbeddedJson = (
  html: string,
  currency: ConsoleCurrency,
): LiveOffer[] => {
  const out: LiveOffer[] = [];
  const scriptRe = /<script[^>]*type="(?:application\/json|application\/ld\+json)"[^>]*>([\s\S]*?)<\/script>/g;
  for (const m of html.matchAll(scriptRe)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const stack: unknown[] = [parsed];
    let steps = 0;
    while (stack.length && steps < 200_000) {
      steps += 1;
      const node = stack.pop();
      if (node == null) continue;
      if (Array.isArray(node)) {
        stack.push(...node);
        continue;
      }
      if (typeof node !== "object") continue;
      const rec = node as Record<string, unknown>;
      const nameText = pickString(rec, [
        "name",
        "title",
        "productName",
        "localName",
        "label",
      ]);
      if (nameText && /ps\s*5|playstation\s*5/i.test(nameText)) {
        const priceRaw = priceValue(rec, [
          "price",
          "currentPrice",
          "salesPrice",
          "offerPrice",
          "unitPrice",
          "discountedPrice",
          "salePrice",
        ]);
        if (priceRaw != null) {
          const model = modelFromText(nameText);
          const maybeMinor = priceRaw >= 1_000_000 ? priceRaw / 100 : priceRaw;
          if (model && inBounds(maybeMinor, currency)) {
            out.push({
              model,
              price: currency === "JPY" || currency === "TRY" ? Math.round(maybeMinor) : Math.round(maybeMinor * 100) / 100,
              currency,
              availability: null,
              name: nameText,
            });
          }
        }
      }
      stack.push(...Object.values(rec));
    }
  }
  return out;
};

/** Pass 3: raw-text currency regex with a ±260-char model-classification window. */
const offersFromRawText = (
  html: string,
  currency: ConsoleCurrency,
): LiveOffer[] => {
  const text = stripTags(html.replace(/<script[\s\S]*?<\/script>/gi, " "));
  const regex = new RegExp(CURRENCY_REGEX[currency].source, "g");
  const byModel = new Map<ModelClass, { price: number; name: string }>();
  for (const m of text.matchAll(regex)) {
    const raw = m[1] ?? m[2];
    if (!raw) continue;
    const price = toNumber(raw);
    if (price == null || !inBounds(price, currency)) continue;
    // Window of text BEFORE the price: names precede prices on storefronts.
    const windowText = text.slice(Math.max(0, (m.index ?? 0) - 280), m.index ?? 0);
    const model = modelFromText(windowText);
    if (!model) continue;
    const snapped =
      currency === "JPY" || currency === "TRY"
        ? Math.round(price)
        : Math.round(price * 100) / 100;
    const prev = byModel.get(model);
    if (!prev || snapped < prev.price) {
      byModel.set(model, { price: snapped, name: windowText.slice(-80).trim() });
    }
  }
  return [...byModel.entries()].map(([model, v]) => ({
    model,
    price: v.price,
    currency,
    availability: null,
    name: null,
  }));
};

interface BuyNowRegion {
  market: EnrichedConsoleDeal["market"];
  currency: ConsoleCurrency;
  url: string;
  acceptLanguage: string;
  psDirectUrl: string | null;
}

const BUY_NOW_REGIONS: BuyNowRegion[] = [
  {
    market: "USA",
    currency: "USD",
    url: "https://www.playstation.com/en-us/ps5/buy-now/",
    acceptLanguage: "en-US,en;q=0.9",
    psDirectUrl: "https://direct.playstation.com/en-us/p/playstation-5-pro",
  },
  {
    market: "UK",
    currency: "GBP",
    url: "https://www.playstation.com/en-gb/ps5/buy-now/",
    acceptLanguage: "en-GB,en;q=0.9",
    psDirectUrl: "https://direct.playstation.com/en-gb/p/playstation-5-pro",
  },
  {
    market: "Europe",
    currency: "EUR",
    url: "https://www.playstation.com/de-de/ps5/buy-now/",
    acceptLanguage: "de-DE,de;q=0.9,en;q=0.8",
    psDirectUrl: "https://direct.playstation.com/en-de/p/playstation-5-pro",
  },
  {
    market: "Japan",
    currency: "JPY",
    url: "https://www.playstation.com/ja-jp/ps5/buy-now/",
    acceptLanguage: "ja-JP,ja;q=0.9,en;q=0.8",
    psDirectUrl: null,
  },
  {
    market: "Turkey",
    currency: "TRY",
    url: "https://www.playstation.com/tr-tr/ps5/buy-now/",
    acceptLanguage: "tr-TR,tr;q=0.9,en-US;q=0.8",
    psDirectUrl: null,
  },
];

const bestOffer = (candidates: LiveOffer[]): LiveOffer | null => {
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.price < a.price ? b : a));
};

/** Fetch + parse one region's buy-now page; returns live offers by model. */
async function fetchRegionOffers(
  region: BuyNowRegion,
  { force }: FetchOpts = {},
): Promise<Map<ModelClass, LiveOffer> | null> {
  const byModel = new Map<ModelClass, LiveOffer>();
  try {
    const res = await fetch(region.url, {
      headers: desktopHeaders(region.acceptLanguage),
      signal: AbortSignal.timeout(12000),
      ...fetchInit(force),
    });
    if (!res.ok) throw new Error(`${region.market} buy-now → HTTP ${res.status}`);
    const html = await res.text();
    const p1 = offersFromJsonLd(html, region.currency);
    const p2 = offersFromEmbeddedJson(html, region.currency);
    const p3 = offersFromRawText(html, region.currency);
    for (const model of ["slim-disc", "slim-digital", "pro"] as const) {
      const chosen =
        bestOffer(p1.filter((o) => o.model === model)) ??
        bestOffer(p2.filter((o) => o.model === model)) ??
        bestOffer(p3.filter((o) => o.model === model));
      if (chosen) byModel.set(model, chosen);
    }
    if (byModel.size === 0) {
      throw new Error(`${region.market} buy-now page yielded no usable prices`);
    }
    return byModel;
  } catch (err) {
    console.warn(`[psn-deals] ${region.market} buy-now fetch failed:`, err);
    // PS Direct regions: try the product page JSON-LD for the Pro row.
    if (region.psDirectUrl) {
      try {
        const res = await fetch(region.psDirectUrl, {
          headers: desktopHeaders(region.acceptLanguage),
          signal: AbortSignal.timeout(12000),
          ...fetchInit(force),
        });
        if (res.ok) {
          const html = await res.text();
          const pro =
            offersFromJsonLd(html, region.currency).find((o) => o.model === "pro") ??
            offersFromOpenGraph(html, region.currency);
          if (pro && pro.model === "pro") {
            byModel.set("pro", pro);
            return byModel;
          }
        }
      } catch (directErr) {
        console.warn(
          `[psn-deals] ${region.market} PS Direct fallback failed:`,
          directErr,
        );
      }
    }
    return byModel.size > 0 ? byModel : null;
  }
}

export interface ConsoleBoardResult {
  rows: EnrichedConsoleDeal[];
  liveCount: number;
  /** Provider summary for the LIVE SOURCE badge (null when fully curated). */
  provider: string | null;
}

export async function getConsoleBoard(
  fx: FxRates,
  opts: FetchOpts = {},
): Promise<ConsoleBoardResult> {
  const perRegion = await Promise.all(
    BUY_NOW_REGIONS.map(async (region) => ({
      region,
      offers: await fetchRegionOffers(region, opts),
    })),
  );

  const providers = new Set<string>();
  const liveRowById = new Map<string, ConsoleDeal>();
  for (const { region, offers } of perRegion) {
    if (!offers || offers.size === 0) continue;
    const rowIds = MODEL_ROW_ID[region.market];
    let any = false;
    for (const [model, offer] of offers) {
      const rowId = rowIds[model];
      const base = CONSOLE_DEALS.find((r) => r.id === rowId);
      if (!base) continue;
      liveRowById.set(rowId, {
        ...base,
        price: offer.price,
        originalPrice: null,
        discountPct: null,
        name: base.name, // keep curated naming so rows stay comparable
        note: `Live price · ${new URL(region.url).hostname} buy-now`,
        retailer: "PlayStation Store",
        availability: offer.availability ?? base.availability,
        url: region.url,
      });
      any = true;
    }
    if (any) providers.add("playstation.com");
  }

  const merged = CONSOLE_DEALS.map((row) => liveRowById.get(row.id) ?? row);
  const rows: EnrichedConsoleDeal[] = merged.map((row) => {
    const rate = fx.bdtRates[row.currency as ConsoleCurrency];
    return {
      ...row,
      bdtPrice: rate && Number.isFinite(rate) ? row.price * rate : null,
      source: liveRowById.has(row.id) ? "live" : "curated",
    };
  });
  if (liveRowById.size > 0) {
    lastLive.consolesAt = Date.now();
    lastLive.consolesProvider = [...providers].join(" + ") || "playstation.com";
  }
  return {
    rows,
    liveCount: liveRowById.size,
    provider: liveRowById.size > 0 ? lastLive.consolesProvider : null,
  };
}
