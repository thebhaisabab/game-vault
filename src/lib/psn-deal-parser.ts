/**
 * Standalone parser for the PlayStation Store TR deals hub HTML
 * (__NEXT_DATA__ embedded JSON). Used by the BROWSER-side rescue path on
 * /psn-deals when the server cannot reach the store (Akamai/datacenter
 * blocks): the user's own browser fetches the page through a public CORS
 * relay, and this module turns the HTML into PsnDealGame[].
 *
 * Deliberately self-contained (no server-only imports, no fetching). The
 * server pipeline in ./psn-deals.ts has its own fuller walker; if the PSN
 * product shape changes, fix both — or better, converge them.
 */
import type { PsnDealGame } from "./psn-deals-data";

const parseNumber = (raw: string): number | null => {
  let s = raw.trim().replace(/[^\d.,-]/g, "");
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, "");
  else {
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastDot > lastComma) s = lastComma === -1 && s.length - lastDot - 1 <= 2 ? s : s.replace(/,/g, "");
    else if (lastComma > lastDot) s = s.length - lastComma - 1 <= 2 ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

const toNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") return parseNumber(v);
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
      const n = toNumber(rec.value) ?? toNumber(rec.amount) ?? toNumber(rec.raw);
      if (n != null) return n;
    }
  }
  return null;
};

const pickString = (obj: Record<string, unknown>, keys: string[]): string | null => {
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

function* walk(
  node: unknown,
  budget: { left: number },
  depth = 0,
): Generator<Record<string, unknown>> {
  if (depth > 16 || budget.left <= 0 || node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) {
      if (budget.left <= 0) return;
      yield* walk(item, budget, depth + 1);
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
    yield* walk(v, budget, depth + 1);
  }
}

const djb2 = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
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

const pickProductId = (rec: Record<string, unknown>): string | null => {
  for (const key of ["id", "productId", "commerceProductId", "namespaceId"]) {
    const v = rec[key];
    if (typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{9,63}$/.test(v) && /\d/.test(v)) {
      return v;
    }
  }
  return null;
};

const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Parse deals from raw deals-hub HTML. Returns discounted PS4/PS5 products
 * deduped by title, sorted by discount % desc. Empty array on any failure.
 */
export function parseDealsHubHtml(html: string, requireDiscount = true): PsnDealGame[] {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match?.[1]) return [];
  let payload: unknown;
  try {
    payload = JSON.parse(match[1]);
  } catch {
    return [];
  }
  const out: PsnDealGame[] = [];
  const seen = new Set<string>();
  for (const rec of walk(payload, { left: 250_000 })) {
    const title = pickString(rec, ["localName", "name", "title"]);
    if (!title) continue;
    let base = priceValue(rec, ["basePrice", "originalPrice", "fullPrice"]);
    let sale = priceValue(rec, [
      "discountedPrice",
      "discountPrice",
      "salePrice",
      "currentPrice",
      "price",
    ]);
    if (base == null || sale == null) continue;
    if (base >= 100_000) {
      base = base / 100;
      sale = sale / 100;
    }
    base = Math.round(base);
    sale = Math.round(sale);
    if (base <= 0 || sale <= 0 || sale > base || base > 200_000) continue;
    const discountPct = Math.min(95, Math.max(0, Math.round((1 - sale / base) * 100)));
    if (requireDiscount && discountPct < 1) continue;
    const key = normTitle(title);
    if (seen.has(key)) continue;
    seen.add(key);
    const probe = JSON.stringify(rec).slice(0, 3000);
    const hasPs5 = /ps\s*5|playstation\s*5/i.test(probe);
    const hasPs4 = /ps\s*4|playstation\s*4/i.test(probe);
    const platforms: Array<"PS5" | "PS4"> =
      hasPs5 && hasPs4 ? ["PS5", "PS4"] : hasPs4 ? ["PS4"] : ["PS5"];
    const productId = pickProductId(rec);
    out.push({
      id: productId ?? `psn-live-${djb2(title.toLowerCase())}`,
      title,
      platforms,
      basePrice: base,
      salePrice: sale,
      discountPct,
      coverUrl: pickImage(rec),
      url: productId
        ? `https://store.playstation.com/en-tr/product/${encodeURIComponent(productId)}`
        : `https://store.playstation.com/en-tr/search/${encodeURIComponent(title)}`,
    });
  }
  return out.sort((a, b) => b.discountPct - a.discountPct);
}
