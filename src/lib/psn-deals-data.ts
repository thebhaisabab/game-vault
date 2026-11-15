/**
 * Shared types + bundled snapshot data for the PS5 deals page.
 * This module is dependency-free (no server-only imports) so client
 * components can import the types.
 *
 * The Turkey deals snapshot and the worldwide console board are curated
 * (see `asOf`) and are always labelled as such in the UI — the live PSN TR
 * fetch happens in `src/lib/psn-deals.ts` and only kicks in when reachable.
 */

export type PsnAvailability =
  | "in_stock"
  | "limited"
  | "out_of_stock"
  | "preorder";
export type ConsoleMarket = "USA" | "UK" | "Europe" | "Japan" | "Turkey";

export interface PsnDealGame {
  id: string;
  title: string;
  platforms: Array<"PS5" | "PS4">;
  /** Original price in Turkish Lira, whole lira (e.g. 2799 = ₺2.799). */
  basePrice: number;
  /** Promotional price in Turkish Lira, whole lira. */
  salePrice: number;
  /** 0–95, always derived from basePrice/salePrice. */
  discountPct: number;
  coverUrl: string | null;
  url: string | null;
}

export interface ConsoleDeal {
  id: string;
  name: string;
  /** Bundle contents, if any. */
  note: string | null;
  market: ConsoleMarket;
  currency: "USD" | "GBP" | "EUR" | "JPY" | "TRY";
  price: number;
  /** Pre-discount price, if discounted. */
  originalPrice: number | null;
  discountPct: number | null;
  retailer: string;
  availability: PsnAvailability;
  url: string;
}

export type ConsoleCurrency = "USD" | "GBP" | "EUR" | "JPY" | "TRY";

export interface FxRates {
  /** How many BDT 1 TRY buys. */
  bdtPerTry: number;
  /** How many TRY 1 BDT buys. */
  tryPerBdt: number;
  /** Live BDT rate per 1 unit of each console-board currency. */
  bdtRates: Record<ConsoleCurrency, number>;
  asOf: string;
  source: "live" | "fallback";
}

// --------------------------------------------------------------- FX -------

/** Offline estimate, only used when the public rate API is unreachable. */
export const FX_FALLBACK: Omit<FxRates, "asOf"> & { asOf: string } = {
  bdtPerTry: 2.9,
  tryPerBdt: 1 / 2.9,
  bdtRates: { USD: 120.5, GBP: 156.2, EUR: 131.1, JPY: 0.8, TRY: 2.9 },
  asOf: "2026-11 (offline estimate)",
  source: "fallback",
};

/** A console-board row after server-side FX conversion. */
export interface EnrichedConsoleDeal extends ConsoleDeal {
  /** Price converted to Taka, null when no rate is available. */
  bdtPrice: number | null;
  source: "live" | "curated";
}

// ------------------------------------------- PSN Turkey curated snapshot --

export const TURKEY_SNAPSHOT_AS_OF = "Nov 2026";

const ps = (title: string) =>
  `https://store.playstation.com/tr-tr/search/${encodeURIComponent(title)}`;

export const TURKEY_SNAPSHOT_GAMES: Array<
  Omit<PsnDealGame, "discountPct" | "url">
> = [
  { id: "snap-tr-01", title: "God of War Ragnarök", platforms: ["PS5", "PS4"], basePrice: 2399, salePrice: 959, coverUrl: null },
  { id: "snap-tr-02", title: "Marvel's Spider-Man 2", platforms: ["PS5"], basePrice: 3099, salePrice: 1549, coverUrl: null },
  { id: "snap-tr-03", title: "The Last of Us Part I", platforms: ["PS5", "PS4"], basePrice: 2899, salePrice: 869, coverUrl: null },
  { id: "snap-tr-04", title: "The Last of Us Part II Remastered", platforms: ["PS5"], basePrice: 3299, salePrice: 1979, coverUrl: null },
  { id: "snap-tr-05", title: "Horizon Forbidden West: Complete Edition", platforms: ["PS5", "PS4"], basePrice: 2799, salePrice: 1119, coverUrl: null },
  { id: "snap-tr-06", title: "Ghost of Tsushima Director's Cut", platforms: ["PS5", "PS4"], basePrice: 2499, salePrice: 999, coverUrl: null },
  { id: "snap-tr-07", title: "Ratchet & Clank: Rift Apart", platforms: ["PS5"], basePrice: 2199, salePrice: 659, coverUrl: null },
  { id: "snap-tr-08", title: "Gran Turismo 7", platforms: ["PS5", "PS4"], basePrice: 2699, salePrice: 1349, coverUrl: null },
  { id: "snap-tr-09", title: "Returnal", platforms: ["PS5"], basePrice: 2399, salePrice: 719, coverUrl: null },
  { id: "snap-tr-10", title: "Death Stranding: Director's Cut", platforms: ["PS5"], basePrice: 2099, salePrice: 629, coverUrl: null },
  { id: "snap-tr-11", title: "Demon's Souls", platforms: ["PS5"], basePrice: 3499, salePrice: 1749, coverUrl: null },
  { id: "snap-tr-12", title: "Uncharted: Legacy of Thieves Collection", platforms: ["PS5", "PS4"], basePrice: 2899, salePrice: 869, coverUrl: null },
  { id: "snap-tr-13", title: "It Takes Two", platforms: ["PS5", "PS4"], basePrice: 999, salePrice: 249, coverUrl: null },
  { id: "snap-tr-14", title: "Elden Ring", platforms: ["PS5"], basePrice: 2499, salePrice: 1499, coverUrl: null },
  { id: "snap-tr-15", title: "FC 26", platforms: ["PS5", "PS4"], basePrice: 2599, salePrice: 1819, coverUrl: null },
  { id: "snap-tr-16", title: "Resident Evil Requiem", platforms: ["PS5"], basePrice: 3199, salePrice: 2559, coverUrl: null },
];

export function withDiscount(
  g: Omit<PsnDealGame, "discountPct" | "url">,
): PsnDealGame {
  const discountPct =
    g.basePrice > 0
      ? Math.min(95, Math.max(1, Math.round((1 - g.salePrice / g.basePrice) * 100)))
      : 0;
  return { ...g, discountPct, url: ps(g.title) };
}

// --------------------------- Worldwide console board · Nov 2026 baseline ---
// Fallback prices captured Nov 2026 — labelled CURATED in the UI. Live fetches
// from playstation.com regional buy-now pages replace these per-row when possible.
// TRY/JPY street prices in particular drift weekly; always verify with retailer.

export const CONSOLES_AS_OF = "Nov 2026";

export const CONSOLE_DEALS: ConsoleDeal[] = [
  // USA (USD)
  { id: "con-us-1", name: "PlayStation 5 Slim (1TB, Disc)", note: null, market: "USA", currency: "USD", price: 549.99, originalPrice: null, discountPct: null, retailer: "Walmart", availability: "in_stock", url: "https://www.walmart.com/search?q=playstation+5" },
  { id: "con-us-2", name: "PlayStation 5 Slim Digital (1TB)", note: null, market: "USA", currency: "USD", price: 499.99, originalPrice: null, discountPct: null, retailer: "Best Buy", availability: "in_stock", url: "https://www.bestbuy.com/site/searchpage.jsp?st=playstation%205" },
  { id: "con-us-3", name: "PlayStation 5 Pro (2TB)", note: null, market: "USA", currency: "USD", price: 749.99, originalPrice: null, discountPct: null, retailer: "Amazon", availability: "in_stock", url: "https://www.amazon.com/s?k=playstation+5+pro" },
  { id: "con-us-4", name: "PS5 Slim + Spider-Man 2 Bundle", note: "Console + Spider-Man 2 + DualSense voucher", market: "USA", currency: "USD", price: 599.99, originalPrice: null, discountPct: null, retailer: "Walmart", availability: "limited", url: "https://www.walmart.com/search?q=ps5+bundle" },
  // UK (GBP)
  { id: "con-uk-1", name: "PlayStation 5 Slim (1TB, Disc)", note: null, market: "UK", currency: "GBP", price: 479.99, originalPrice: null, discountPct: null, retailer: "Amazon UK", availability: "in_stock", url: "https://www.amazon.co.uk/s?k=ps5" },
  { id: "con-uk-2", name: "PlayStation 5 Slim Digital (1TB)", note: null, market: "UK", currency: "GBP", price: 429.99, originalPrice: 479.99, discountPct: 10, retailer: "Currys", availability: "in_stock", url: "https://www.currys.co.uk/search?q=ps5" },
  { id: "con-uk-3", name: "PlayStation 5 Pro (2TB)", note: null, market: "UK", currency: "GBP", price: 699.99, originalPrice: null, discountPct: null, retailer: "Argos", availability: "in_stock", url: "https://www.argos.co.uk/search/ps5/" },
  { id: "con-uk-4", name: "PS5 Slim + Astro Bot Bundle", note: "Console + Astro Bot + 3 months PS Plus Essential", market: "UK", currency: "GBP", price: 449.99, originalPrice: 479.99, discountPct: 6, retailer: "Argos", availability: "limited", url: "https://www.argos.co.uk/search/ps5+bundle/" },
  // Europe (EUR)
  { id: "con-eu-1", name: "PlayStation 5 Slim (1TB, Disc)", note: null, market: "Europe", currency: "EUR", price: 549.99, originalPrice: null, discountPct: null, retailer: "MediaMarkt", availability: "in_stock", url: "https://www.mediamarkt.de/de/search.html?query=ps5" },
  { id: "con-eu-2", name: "PlayStation 5 Slim Digital (1TB)", note: null, market: "Europe", currency: "EUR", price: 499.99, originalPrice: 549.99, discountPct: 9, retailer: "MediaMarkt", availability: "in_stock", url: "https://www.mediamarkt.de/de/search.html?query=ps5+digital" },
  { id: "con-eu-3", name: "PlayStation 5 Pro (2TB)", note: null, market: "Europe", currency: "EUR", price: 799.99, originalPrice: null, discountPct: null, retailer: "Amazon.de", availability: "in_stock", url: "https://www.amazon.de/s?k=ps5+pro" },
  { id: "con-eu-4", name: "PS5 Slim + Astro Bot Bundle", note: "Console + Astro Bot + 3 months PS Plus Essential", market: "Europe", currency: "EUR", price: 519.99, originalPrice: 549.99, discountPct: 5, retailer: "MediaMarkt", availability: "limited", url: "https://www.mediamarkt.de/de/search.html?query=ps5+bundle" },
  // Japan (JPY)
  { id: "con-jp-1", name: "PlayStation 5 Slim (1TB, Disc)", note: null, market: "Japan", currency: "JPY", price: 92980, originalPrice: null, discountPct: null, retailer: "Yodobashi", availability: "in_stock", url: "https://www.yodobashi.com/?word=playstation+5" },
  { id: "con-jp-2", name: "PlayStation 5 Slim Digital (1TB)", note: null, market: "Japan", currency: "JPY", price: 84980, originalPrice: null, discountPct: null, retailer: "Amazon Japan", availability: "limited", url: "https://www.amazon.co.jp/s?k=ps5" },
  { id: "con-jp-3", name: "PlayStation 5 Pro (2TB)", note: null, market: "Japan", currency: "JPY", price: 122980, originalPrice: null, discountPct: null, retailer: "Yodobashi", availability: "in_stock", url: "https://www.yodobashi.com/?word=ps5+pro" },
  // Turkey (TRY)
  { id: "con-tr-1", name: "PlayStation 5 Slim (1TB, Disc)", note: null, market: "Turkey", currency: "TRY", price: 45999, originalPrice: null, discountPct: null, retailer: "Trendyol", availability: "in_stock", url: "https://www.trendyol.com/sr?q=playstation%205" },
  { id: "con-tr-2", name: "PlayStation 5 Slim Digital (1TB)", note: null, market: "Turkey", currency: "TRY", price: 39999, originalPrice: null, discountPct: null, retailer: "Hepsiburada", availability: "limited", url: "https://www.hepsiburada.com/ara?q=playstation%205" },
  { id: "con-tr-3", name: "PlayStation 5 Pro (2TB)", note: null, market: "Turkey", currency: "TRY", price: 72999, originalPrice: null, discountPct: null, retailer: "Trendyol", availability: "out_of_stock", url: "https://www.trendyol.com/sr?q=ps5%20pro" },
  { id: "con-tr-4", name: "PS5 Slim + Astro Bot Bundle", note: "Console + Astro Bot + DualSense edge voucher", market: "Turkey", currency: "TRY", price: 54999, originalPrice: null, discountPct: null, retailer: "Trendyol", availability: "limited", url: "https://www.trendyol.com/sr?q=ps5%20bundle" },
];

export const MARKET_ORDER: ConsoleMarket[] = [
  "USA",
  "UK",
  "Europe",
  "Japan",
  "Turkey",
];

const CURRENCY_SYMBOL: Record<ConsoleDeal["currency"], string> = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  JPY: "¥",
  TRY: "₺",
};

export function formatConsolePrice(d: ConsoleDeal): string {
  const sym = CURRENCY_SYMBOL[d.currency];
  const abs = Math.abs(d.price);
  const formatted =
    d.currency === "JPY" || d.currency === "TRY"
      ? Math.round(abs).toLocaleString("en-US")
      : abs.toFixed(2);
  return `${sym}${formatted}`;
}

export function formatTry(amount: number): string {
  return `₺${Math.round(amount).toLocaleString("tr-TR")}`;
}
