/**
 * Official PlayStation Store GraphQL client — the PRIMARY live source for
 * PSN Turkey deals (GET https://web.np.playstation.com/api/graphql/v1/op).
 *
 * Why: Vercel/AWS datacenter IPs are blanket-blocked (403) by Akamai on the
 * storefront HTML, and the public CORS relays are unreliable. The storefront's
 * own persisted-query GraphQL endpoint is served from a different edge path and
 * answers with structured JSON (no HTML parsing).
 *
 * Edge-safe: fetch only, no node APIs. Every function returns null on any
 * failure so callers can fall back (HTML relay chain → Neon cache → honest
 * unavailable) — this module NEVER fabricates deals.
 *
 * Notes on the persisted queries (Sony rotates these with storefront builds):
 *   - `categoryGridRetrieve` hash below is the one used by the live EN-TR
 *     storefront; it returns the full grid inline (concepts/products with
 *     localized prices and media).
 *   - There is no publicly known `searchRetrieve` sha256. The universal-search
 *     persisted query observed in the open storefront codebase is
 *     `getSearchResults` (countryCode/languageCode/nextCursor/pageOffset/
 *     pageSize/searchTerm). Both are overridable via PSN_SEARCH_OPERATION /
 *     PSN_SEARCH_SHA256 without a redeploy. When the search response embeds
 *     priced products (the search page renders prices inline) the same parser
 *     extracts them; when it returns ids only, the parser finds nothing and
 *     the caller falls back to the storefront-HTML search chain.
 */

import {
  ALL_DEALS_CATEGORY,
  type PsnDealGame,
} from "./psn-deals-data";

const REVALIDATE_SECONDS = 1800; // keep in sync with psn-deals.ts

// Endpoint override for local integration testing (mock storefront). Inert in
// production unless PSN_GRAPHQL_ENDPOINT is explicitly set.
const GRAPHQL_ENDPOINT =
  process.env.PSN_GRAPHQL_ENDPOINT?.trim() ||
  "https://web.np.playstation.com/api/graphql/v1/op";
const GRID_PAGE_SIZE = 48;
const CATEGORY_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CATEGORY_GRID_OPERATION = "categoryGridRetrieve";
const CATEGORY_GRID_SHA256 =
  "4ce7d410a4db2c8b635a48c1dcec375906ff63b19daca87e01b4480e1975e222";

const SEARCH_OPERATION =
  process.env.PSN_SEARCH_OPERATION?.trim() || "getSearchResults";
const SEARCH_SHA256 =
  process.env.PSN_SEARCH_SHA256?.trim() ||
  "4df6284f982e57bec70f23c77e2c219dc792eb19af7fb3d3a81767aa3f1958aa";

/** Storefront API headers — mirrors what the web client sends (TR locale). */
const GRAPHQL_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "Accept-Language": "en-TR,en;q=0.9,tr;q=0.8",
  "Content-Type": "application/json",
  Origin: "https://store.playstation.com",
  Referer: "https://store.playstation.com/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "x-psn-store-locale-override": "tr-TR",
};

export interface GraphqlDealsResult {
  games: PsnDealGame[];
  provider: string;
}

export interface GraphqlSearchResult {
  results: PsnDealGame[];
  provider: string;
}

async function psnGraphql(
  operationName: string,
  sha256Hash: string,
  variables: Record<string, unknown>,
  { force }: { force?: boolean } = {},
): Promise<unknown> {
  const params = new URLSearchParams({
    operationName,
    variables: JSON.stringify(variables),
    extensions: JSON.stringify({
      persistedQuery: { version: 1, sha256Hash },
    }),
  });
  const init = force
    ? ({ cache: "no-store" } as const)
    : ({ next: { revalidate: REVALIDATE_SECONDS } } as const);
  const res = await fetch(`${GRAPHQL_ENDPOINT}?${params.toString()}`, {
    headers: GRAPHQL_HEADERS,
    ...init,
  });
  if (!res.ok) {
    throw new Error(`PSN GraphQL HTTP ${res.status} for ${operationName}`);
  }
  const json = (await res.json()) as {
    data?: unknown;
    errors?: Array<{ message?: string }>;
  };
  if (Array.isArray(json?.errors) && json.errors.length > 0) {
    throw new Error(
      `PSN GraphQL ${operationName} error: ${
        json.errors[0]?.message ?? "unknown"
      }`,
    );
  }
  if (!json?.data) {
    throw new Error(`PSN GraphQL ${operationName}: response had no data`);
  }
  return json.data;
}

// ------------------------------------------------------------- parsing -----

/** Parse a localized number, disambiguating en/de thousand & decimal separators. */
const parseLocalizedNumber = (raw: string): number | null => {
  let s = raw.trim().replace(/[^\d.,-]/g, "");
  if (!s) return null;
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

const toNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") return parseLocalizedNumber(v);
  return null;
};

const normTitle = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, "");

const djb2 = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
};

/** Yield every object in the tree (depth- and budget-bounded). */
function* walkAll(
  node: unknown,
  depth: number,
  budget: { left: number },
): Generator<Record<string, unknown>> {
  if (depth > 18 || budget.left <= 0 || node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) {
      if (budget.left <= 0) return;
      yield* walkAll(item, depth + 1, budget);
    }
    return;
  }
  if (typeof node !== "object") return;
  const rec = node as Record<string, unknown>;
  budget.left -= 1;
  yield rec;
  for (const v of Object.values(rec)) {
    if (budget.left <= 0) return;
    yield* walkAll(v, depth + 1, budget);
  }
}

interface PricePair {
  base: number;
  sale: number;
}

const TRY_CURRENCY_RE = /^(try|tl|₺)$/i;

/**
 * Find a TRY price pair inside a subtree. Looks for the storefront's
 * PsStorePrice shape (basePriceValue/discountedValue or basePrice/
 * discountedPrice, number or localized string) at a SINGLE node, so fields
 * from sibling nodes are never mixed. Minor units (kuruş) are normalised.
 */
const findPricePair = (root: Record<string, unknown>): PricePair | null => {
  for (const node of walkAll(root, 0, { left: 1500 })) {
    const base =
      toNumber(node.basePriceValue) ??
      toNumber(node.basePrice) ??
      toNumber(node.originalPrice) ??
      toNumber(node.fullPrice) ??
      toNumber(node.wasPrice) ??
      toNumber(node.launchPrice);
    const sale =
      toNumber(node.discountedValue) ??
      toNumber(node.discountedPrice) ??
      toNumber(node.discountPrice) ??
      toNumber(node.salePrice) ??
      toNumber(node.currentPrice) ??
      toNumber(node.purchasePrice);
    if (base == null || sale == null) continue;
    // When a currency marker exists it must be TRY — never mix currencies.
    const currency =
      typeof node.currencyCode === "string"
        ? node.currencyCode
        : typeof node.currency === "string"
          ? node.currency
          : null;
    if (currency && !TRY_CURRENCY_RE.test(currency.trim())) continue;
    let b = base;
    let s = sale;
    if (b >= 100_000) {
      b = b / 100;
      s = s / 100;
    }
    b = Math.round(b);
    s = Math.round(s);
    if (b <= 0 || s <= 0 || s > b) continue;
    if (b > 200_000 || s < 10) continue;
    return { base: b, sale: s };
  }
  return null;
};

const IMAGE_URL_RE = /^https?:\/\/[^\s"'\\]+\.(?:jpe?g|png|webp)(?:\?[^\s"'\\]*)?$/i;
const IMAGE_HOST_HINT_RE = /(image\.api\.playstation\.com|storestatic|image\.playstation\.com|\/vulcan\/|\/image\/)/i;

/** Best cover URL inside a subtree: storefront image hosts preferred. */
const findCoverUrl = (root: Record<string, unknown>): string | null => {
  let hinted: string | null = null;
  let plain: string | null = null;
  for (const node of walkAll(root, 0, { left: 1500 })) {
    for (const value of Object.values(node)) {
      if (typeof value !== "string") continue;
      const v = value.trim();
      if (!IMAGE_URL_RE.test(v)) continue;
      if (IMAGE_HOST_HINT_RE.test(v)) {
        if (!hinted) hinted = v;
      } else if (!plain) {
        plain = v;
      }
      if (hinted) return hinted;
    }
  }
  return hinted ?? plain;
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

const pickId = (rec: Record<string, unknown>): string | null => {
  for (const key of ["id", "productId", "commerceProductId", "namespaceId", "conceptId"]) {
    const v = rec[key];
    if (typeof v === "string") {
      const t = v.trim();
      // Product ids look like "UP1003-PPSA18178_00-XXXXXXXXXXXXXXXX";
      // concept ids are long numerics.
      if (/^UP[0-9]{4}-[A-Z0-9_]+$/.test(t)) return t;
      if (/^\d{9,}$/.test(t)) return t;
    }
  }
  // Nested concept reference: { concept: { id } }
  const concept = rec.concept;
  if (concept && typeof concept === "object") {
    const id = (concept as Record<string, unknown>).id;
    if (typeof id === "string" && /^\d{9,}$/.test(id.trim())) return id.trim();
  }
  return null;
};

const platformOf = (probe: string): Array<"PS5" | "PS4"> => {
  const hasPs5 = /ps\s*5|playstation\s*5/i.test(probe);
  const hasPs4 = /ps\s*4|playstation\s*4/i.test(probe);
  if (hasPs5 && hasPs4) return ["PS5", "PS4"];
  if (hasPs4) return ["PS4"];
  return ["PS5"];
};

/**
 * Extract PsnDealGame[] from any storefront GraphQL payload. Candidate nodes
 * are objects carrying BOTH a plausible name and a TRY price pair somewhere in
 * their subtree; nested duplicates (concept wrapping product) collapse via
 * title dedupe. With requireDiscount=false every priced item is kept
 * (watchlist lookup wants full-price rows too).
 */
export function parseGraphqlGames(
  payload: unknown,
  { requireDiscount, limit }: { requireDiscount: boolean; limit: number },
): PsnDealGame[] {
  if (payload == null || typeof payload !== "object") return [];
  const seen = new Set<string>();
  const out: PsnDealGame[] = [];
  for (const node of walkAll(payload, 0, { left: 250_000 })) {
    const title = pickString(node, ["localName", "name", "title", "displayName"]);
    if (!title || title.length < 2 || title.length > 160) continue;
    // Only consider nodes that look like a product container: they must carry
    // a price pair in their own subtree. Skip tiny scalar subtrees early.
    const price = findPricePair(node);
    if (!price) continue;
    // Concepts nest products; both are walked. Keep the FIRST occurrence of a
    // title (outer node carries the same display name) — dedupe handles it.
    const key = normTitle(title);
    if (seen.has(key)) continue;
    seen.add(key);
    const discountPct = Math.min(
      95,
      Math.max(0, Math.round((1 - price.sale / price.base) * 100)),
    );
    if (requireDiscount && discountPct < 1) continue;
    const probe = JSON.stringify(node).slice(0, 1500);
    const id = pickId(node);
    out.push({
      id: id ?? `psn-gql-${djb2(title.toLowerCase())}`,
      title,
      platforms: platformOf(probe),
      basePrice: price.base,
      salePrice: price.sale,
      discountPct,
      coverUrl: findCoverUrl(node),
      url: id
        ? /^\d+$/.test(id)
          ? `https://store.playstation.com/en-tr/concept/${encodeURIComponent(id)}`
          : `https://store.playstation.com/en-tr/product/${encodeURIComponent(id)}`
        : `https://store.playstation.com/en-tr/search/${encodeURIComponent(title)}`,
    });
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => b.discountPct - a.discountPct);
}

const ALL_DEALS_LOWER = ALL_DEALS_CATEGORY.toLowerCase();

/**
 * Live PSN Turkey game deals for one category (default: All Deals) via the
 * official storefront GraphQL API. Returns null on ANY failure — the caller
 * falls back to the HTML relay chain and then the Neon cache.
 */
export async function fetchTurkeyDealsGraphQL({
  force,
  categoryId,
}: {
  force?: boolean;
  categoryId?: string;
} = {}): Promise<GraphqlDealsResult | null> {
  const category =
    categoryId && CATEGORY_ID_RE.test(categoryId)
      ? categoryId.toLowerCase()
      : ALL_DEALS_LOWER;
  const data = await psnGraphql(
    CATEGORY_GRID_OPERATION,
    CATEGORY_GRID_SHA256,
    {
      id: category,
      pageArgs: { size: GRID_PAGE_SIZE, offset: 0 },
      sortBy: null,
      filterBy: [],
      facetOptions: [],
    },
    { force },
  );
  const games = parseGraphqlGames(data, { requireDiscount: true, limit: 60 });
  if (games.length === 0) return null;
  return {
    games,
    provider: "web.np.playstation.com (categoryGridRetrieve)",
  };
}

/**
 * Live catalog search for one title (watchlist lookup) via the storefront's
 * universal-search persisted query (TR locale). Returns null when the response
 * embeds no priced products (e.g. ids-only hits) or on any failure — the
 * caller falls back to the storefront-HTML search chain.
 */
export async function searchPsnGraphQL(
  query: string,
  { force }: { force?: boolean } = {},
): Promise<GraphqlSearchResult | null> {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return null;
  const data = await psnGraphql(
    SEARCH_OPERATION,
    SEARCH_SHA256,
    {
      countryCode: "TR",
      languageCode: "en",
      nextCursor: "",
      pageOffset: 0,
      pageSize: 25,
      searchTerm: q,
    },
    { force },
  );
  const needle = normTitle(q);
  const games = parseGraphqlGames(data, { requireDiscount: false, limit: 25 });
  const matched = games.filter((g) => normTitle(g.title).includes(needle));
  const pool = matched.length > 0 ? matched : games;
  if (pool.length === 0) return null;
  return {
    results: pool
      .sort((a, b) => b.discountPct - a.discountPct)
      .slice(0, 10),
    provider: `web.np.playstation.com (${SEARCH_OPERATION})`,
  };
}
