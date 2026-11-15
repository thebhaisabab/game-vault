import type { GameSearchResult, SearchResponse } from "./types";

/**
 * Game search provider chain — fully keyless, zero environment variables:
 *   1. Steam Store search — PC catalogue with app-id based CDN artwork, great
 *      relevance for PC releases and multi-platform games also sold on Steam
 *   2. Wikipedia + Wikidata — covers console exclusives and multi-platform
 *      titles (search via the MediaWiki API, box art via images + imageinfo
 *      plus the REST page summary, structured facts via the Wikidata API:
 *      release year, platforms, developer, publisher; instance of (P31) is
 *      used to drop non-game articles)
 *
 * Both sources are queried in parallel; results are interleaved, de-duplicated
 * by normalised title (metadata merged field-by-field), and capped at 25.
 */

const PLATFORM_MAP: Record<string, string> = {
  "PC (Microsoft Windows)": "PC",
  "Microsoft Windows": "PC",
  Windows: "PC",
  "Windows 10": "PC",
  "Windows 11": "PC",
  DOS: "DOS",
  "Xbox Series X|S": "Xbox Series X|S",
  "Xbox Series S/X": "Xbox Series X|S",
  "Xbox Series X and Series S": "Xbox Series X|S",
  "Xbox Series X": "Xbox Series X|S",
  "PlayStation 5": "PS5",
  "PlayStation 4": "PS4",
  "PlayStation 3": "PS3",
  "PlayStation 2": "PS2",
  PlayStation: "PS1",
  "PlayStation Portable": "PSP",
  "PlayStation Vita": "PS Vita",
  "Nintendo Switch": "Switch",
  "Nintendo Switch 2": "Switch 2",
  "Wii U": "Wii U",
  Wii: "Wii",
  "Nintendo GameCube": "GameCube",
  GameCube: "GameCube",
  "Nintendo 64": "N64",
  "Nintendo 3DS": "3DS",
  "Nintendo DS": "DS",
  "Game Boy Advance": "GBA",
  "Game Boy Color": "Game Boy Color",
  "Game Boy": "Game Boy",
  "Super Nintendo Entertainment System": "SNES",
  "Nintendo Entertainment System": "NES",
  "Sega Mega Drive/Genesis": "Genesis",
  "Sega Mega Drive": "Genesis",
  "Mega Drive": "Genesis",
  "Sega Saturn": "Saturn",
  Saturn: "Saturn",
  "Web browser": "Web",
  "Xbox One": "Xbox One",
  "Xbox 360": "Xbox 360",
  Xbox: "Xbox",
  Mac: "Mac",
  macOS: "Mac",
  "Mac OS": "Mac",
  "OS X": "Mac",
  Linux: "Linux",
  iOS: "iOS",
  Android: "Android",
  Arcade: "Arcade",
  Dreamcast: "Dreamcast",
  "Sega Dreamcast": "Dreamcast",
  Amiga: "Amiga",
  "ZX Spectrum": "ZX Spectrum",
};

function shortPlatforms(names: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const n of names) {
    if (!n) continue;
    const mapped = PLATFORM_MAP[n] ?? n;
    if (mapped && mapped.length <= 18) out.add(mapped);
  }
  return [...out];
}

const MAX_RESULTS = 25;

const USER_AGENT =
  "GameVault/1.0 (https://github.com/thebhaisabab/game-vault; game search)";

// --------------------------------------------------------------- Steam ----

interface SteamItem {
  type?: string;
  id: number | string;
  name: string;
  metascore?: string;
  platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
}

/**
 * Steam ships DLCs, soundtracks, upgrade packs and merch as "app" entries.
 * Name-pattern filtering keeps the base games in and the junk out.
 */
const STEAM_JUNK_PATTERNS = [
  /\bupgrade to\b/i,
  /\bdlc\b/i,
  /\bdownloadable content\b/i,
  /\bsound\s?tracks?\b/i,
  /\bost\b/i,
  /\boriginal score\b/i,
  /\bseason pass\b/i,
  /\bexpansion pass\b/i,
  /\bpre-?order bonus\b/i,
  /\bbonus (?:content|pack|edition)\b/i,
  /\bsupporter pack\b/i,
  /\bart\s?books?\b/i,
  /\bwallpapers?\b/i,
  /\bdigital (?:poster|extras|soundtrack)\b/i,
];

const isSteamJunk = (name: string) =>
  STEAM_JUNK_PATTERNS.some((re) => re.test(name));

async function searchSteam(query: string): Promise<GameSearchResult[]> {
  const url =
    `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(
      query,
    )}&l=english&cc=US`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(9000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Steam search failed (${res.status})`);
  const data = (await res.json()) as { items?: SteamItem[] };

  return (data.items ?? [])
    .filter((g) => (!g.type || g.type === "app") && !isSteamJunk(g.name ?? ""))
    .flatMap((g): GameSearchResult[] => {
      const appId = Number(g.id);
      if (!Number.isFinite(appId) || !g.name) return [];
      const platforms = ["PC"];
      if (g.platforms?.mac) platforms.push("Mac");
      if (g.platforms?.linux) platforms.push("Linux");
      const meta = g.metascore ? Number.parseInt(g.metascore, 10) : NaN;
      return [
        {
          externalId: `steam:${appId}`,
          source: "steam",
          title: g.name,
          coverUrl: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
          heroUrl: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
          summary: null,
          developer: null,
          publisher: null,
          genres: [],
          platforms,
          releaseYear: null,
          releaseDate: null,
          criticScore: Number.isFinite(meta) && meta > 0 ? meta : null,
        } satisfies GameSearchResult,
      ];
    })
    .slice(0, MAX_RESULTS);
}

// ----------------------------------------------------------- Wikipedia ----

interface WikiPage {
  pageid?: number;
  title?: string;
  description?: string;
  extract?: string;
  thumbnail?: { source?: string };
  original?: { source?: string };
  pageprops?: { wikibase_item?: string };
  images?: Array<{ title?: string }>;
}

interface WikidataDetails {
  year: number | null;
  date: string | null;
  platformIds: string[];
  developerIds: string[];
  publisherIds: string[];
  instanceOfIds: string[];
}

/**
 * Strip a trailing disambiguation qualifier from article titles, e.g.
 * "Infamous (video game)" -> "Infamous". Leaves real titles untouched.
 */
function cleanWikipediaTitle(title: string): string {
  return title.replace(/\s*\([^)]*\bgames?\b[^)]*\)\s*$/i, "").trim();
}

async function fetchWikipediaPages(query: string): Promise<WikiPage[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    // Biasing the query toward video games keeps console exclusives ranked
    // highly while still matching any title containing the search text.
    gsrsearch: `${query} video game`,
    gsrnamespace: "0",
    gsrlimit: String(MAX_RESULTS),
    prop: "pageprops|pageimages|description|extracts|images",
    ppprop: "wikibase_item",
    piprop: "thumbnail|original",
    pithumbsize: "600",
    pilimit: "50",
    imlimit: "100",
    exintro: "1",
    explaintext: "1",
    exsentences: "2",
    redirects: "1",
  });
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(9000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Wikipedia search failed (${res.status})`);
  const data = (await res.json()) as { query?: { pages?: WikiPage[] } };
  return data.query?.pages ?? [];
}

async function fetchWikidataDetails(
  ids: string[],
): Promise<Map<string, WikidataDetails>> {
  const out = new Map<string, WikidataDetails>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const params = new URLSearchParams({
      action: "wbgetentities",
      ids: chunk.join("|"),
      props: "claims",
      format: "json",
    });
    const res = await fetch(`https://www.wikidata.org/w/api.php?${params}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(9000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Wikidata claims failed (${res.status})`);
    const data = (await res.json()) as {
      entities?: Record<
        string,
        { claims?: Record<string, Array<Record<string, unknown>>> }
      >;
    };

    for (const [qid, entity] of Object.entries(data.entities ?? {})) {
      const claims = entity.claims ?? {};
      const timeOf = (pid: string): string | null => {
        for (const claim of claims[pid] ?? []) {
          const value = (claim as any)?.mainsnak?.datavalue?.value;
          if (value && typeof value.time === "string") return value.time;
        }
        return null;
      };
      const entityIdsOf = (pid: string): string[] => {
        const idsOut: string[] = [];
        for (const claim of claims[pid] ?? []) {
          const id = (claim as any)?.mainsnak?.datavalue?.value?.id;
          if (typeof id === "string") idsOut.push(id);
        }
        return idsOut;
      };

      const time = timeOf("P577") ?? timeOf("P571"); // publication date, else inception
      const m = time?.match(/^\+?(\d{4})-(\d{2})-(\d{2})/);
      const year = m ? Number.parseInt(m[1], 10) : null;
      const date =
        m && m[2] !== "00" && m[3] !== "00"
          ? `${m[1]}-${m[2]}-${m[3]}`
          : null;

      out.set(qid, {
        year,
        date,
        platformIds: entityIdsOf("P400"), // platform
        developerIds: entityIdsOf("P178"), // developer
        publisherIds: entityIdsOf("P123"), // publisher
        instanceOfIds: entityIdsOf("P31"), // instance of
      });
    }
  }
  return out;
}

async function fetchWikidataLabels(
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const params = new URLSearchParams({
      action: "wbgetentities",
      ids: chunk.join("|"),
      props: "labels",
      languages: "en",
      format: "json",
    });
    const res = await fetch(`https://www.wikidata.org/w/api.php?${params}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(9000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Wikidata labels failed (${res.status})`);
    const data = (await res.json()) as {
      entities?: Record<string, { labels?: { en?: { value?: string } } }>;
    };
    for (const [qid, entity] of Object.entries(data.entities ?? {})) {
      const label = entity.labels?.en?.value;
      if (typeof label === "string") out.set(qid, label);
    }
  }
  return out;
}

// ---------------------------------------------------- Junk/game filters ---

/** Articles we never want in a game vault, matched against raw titles. */
const JUNK_TITLE_PATTERNS = [
  /^list of\b/i,
  /^development of\b/i,
  /^music of\b/i,
  /^making of\b/i,
  /\(disambiguation\)\s*$/i,
  /\((?:film|tv series|television series|soundtrack|song|album)\)\s*$/i,
  /\bsound\s?tracks?\b/i,
];

/** Wikidata "video game" — the anchor class for P31 checks. */
const VIDEO_GAME_QID = "Q7889";

/** Labels on an `instance of` claim that clearly mean "this is a game". */
const GAME_CLASS_LABEL =
  /\b(video\s?games?|computer\s?games?|console\s?games?|arcade\s?games?|visual\s?novels?|interactive\s?(?:fiction|movies?)|serious\s?games?|handheld\s?games?)\b/i;

function isJunkTitle(title: string): boolean {
  return JUNK_TITLE_PATTERNS.some((re) => re.test(title));
}

/**
 * Decide whether a Wikipedia page is (or is about) a game.
 *
 * With Wikidata claims available: require the page's
 * `instance of` (P31) to include the video game class itself or a class
 * whose English label looks game-ish (covers subclasses like racing/video
 * game, visual novel, ...). People ("human"), films, TV series and Wikimedia
 * list articles all fall out naturally. Without claims (item missing or
 * fetch failed), fall back to a text heuristic.
 */
function isGamePage(
  page: WikiPage,
  details: WikidataDetails | undefined,
  labels: Map<string, string>,
): boolean {
  const title = page.title ?? "";
  if (isJunkTitle(title)) return false;

  if (details) {
    if (details.instanceOfIds.includes(VIDEO_GAME_QID)) return true;
    const classLabels = details.instanceOfIds
      .map((id) => labels.get(id))
      .filter((l): l is string => Boolean(l));
    if (classLabels.length > 0) {
      return classLabels.some((l) => GAME_CLASS_LABEL.test(l));
    }
    // Claims existed but no P31/labels resolvable — use the text heuristic.
  }
  return /game/i.test(
    `${title} ${page.description ?? ""} ${page.extract ?? ""}`,
  );
}

// --------------------------------------------------- Wikipedia artwork -----

/** Files that are never useful cover art. */
const BAD_IMAGE_PATTERN =
  /(commons[- ]logo|wikimedia|favicon|icon|logo|symbol|ambox|padlock|disambig|edit[- ]clear|increase|decrease|crystal|sprite|button|arrow|bullet|question|stub|folder|portal|nuvola|ooui|gnome|featured|good[-_ ]?article|\bopa$)/i;
const BAD_IMAGE_EXT = /\.(svg|gif|xcf|djvu?|tiff?)$/i;
const GOOD_IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
/** Filename hints that strongly suggest actual box/key art. */
const ART_IMAGE_NAME = /(cover|box[-_ ]?art|key[-_ ]?art|artwork|poster)/i;
/** Secondary hints: usable, but prefer real box art when available. */
const SECONDARY_IMAGE_NAME = /(banner|wallpaper|screenshot|gameplay)/i;

function scoreWikiFile(title: string): number {
  if (BAD_IMAGE_EXT.test(title)) return -1;
  if (BAD_IMAGE_PATTERN.test(title)) return -1;
  if (!GOOD_IMAGE_EXT.test(title)) return 0;
  if (ART_IMAGE_NAME.test(title)) return 100;
  if (SECONDARY_IMAGE_NAME.test(title)) return 20;
  return 10;
}

const fileKey = (t: string) => t.replace(/_/g, " ").trim().toLowerCase();

interface WikiImageInfo {
  url: string;
  thumbUrl: string | null;
  width: number | null;
  mime: string | null;
}

/** Batch-resolve File: titles (<=50 per request) to URLs and sizes. */
async function fetchImageInfo(
  fileTitles: string[],
): Promise<Map<string, WikiImageInfo>> {
  const out = new Map<string, WikiImageInfo>();
  const unique = [...new Set(fileTitles)];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      prop: "imageinfo",
      iiprop: "url|size|mime",
      iiurlwidth: "600",
      titles: chunk.join("|"),
    });
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(9000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Wikipedia imageinfo failed (${res.status})`);
    const data = (await res.json()) as {
      query?: {
        pages?: Array<{
          title?: string;
          imageinfo?: Array<{
            url?: string;
            thumburl?: string;
            width?: number;
            mime?: string;
          }>;
        }>;
      };
    };
    for (const pg of data.query?.pages ?? []) {
      const info = pg.imageinfo?.[0];
      if (!pg.title || !info?.url) continue;
      out.set(fileKey(pg.title), {
        url: info.url,
        thumbUrl: info.thumburl ?? null,
        width: typeof info.width === "number" ? info.width : null,
        mime: info.mime ?? null,
      });
    }
  }
  return out;
}

/** Pick the best box-art candidate per page; returns file titles to resolve. */
function artCandidates(page: WikiPage): string[] {
  const files = (page.images ?? [])
    .map((f) => f.title)
    .filter((t): t is string => Boolean(t));
  const scored = files
    .map((title) => ({ title, score: scoreWikiFile(title) }))
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score);
  // Two candidates per page keeps the imageinfo batch small.
  return scored.slice(0, 2).map((f) => f.title);
}

/** Choose the best resolved image for a page from the imageinfo results. */
function pickArt(
  candidates: string[],
  info: Map<string, WikiImageInfo>,
): WikiImageInfo | null {
  let best: WikiImageInfo | null = null;
  let bestScore = -1;
  for (const title of candidates) {
    const entry = info.get(fileKey(title));
    if (!entry) continue;
    if (entry.mime && !/^image\/(jpeg|png|webp)$/.test(entry.mime)) continue;
    const score = scoreWikiFile(title) * 1_000_000 + (entry.width ?? 0);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best;
}

/** REST page summary fallback for pages with no usable images. */
async function fetchRestSummaryArt(
  title: string,
): Promise<{ coverUrl: string | null; heroUrl: string | null }> {
  const res = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      title.replace(/\s+/g, "_"),
    )}`,
    {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    },
  );
  if (!res.ok) return { coverUrl: null, heroUrl: null };
  const data = (await res.json()) as {
    thumbnail?: { source?: string };
    originalimage?: { source?: string };
  };
  const cover = data.thumbnail?.source ?? data.originalimage?.source ?? null;
  return { coverUrl: cover, heroUrl: data.originalimage?.source ?? cover };
}

async function searchWikipedia(query: string): Promise<GameSearchResult[]> {
  const rawPages = await fetchWikipediaPages(query);

  // Drop obvious junk up front (lists, soundtracks, films...); the
  // Wikidata-backed game check runs after claims are fetched.
  const candidatePages = rawPages.filter((p) => !isJunkTitle(p.title ?? ""));

  const wdIds = candidatePages
    .map((p) => p.pageprops?.wikibase_item)
    .filter((id): id is string => Boolean(id));

  // Wikidata enrichment is best-effort: without it we still return titles,
  // descriptions and artwork from Wikipedia.
  const details = wdIds.length
    ? await fetchWikidataDetails(wdIds).catch((err) => {
        console.error("[game-provider] Wikidata claims failed:", err);
        return new Map<string, WikidataDetails>();
      })
    : new Map<string, WikidataDetails>();

  const referencedIds: string[] = [];
  for (const d of details.values()) {
    referencedIds.push(
      ...d.platformIds,
      ...d.instanceOfIds,
      ...d.developerIds.slice(0, 1),
      ...d.publisherIds.slice(0, 1),
    );
  }
  const labels = referencedIds.length
    ? await fetchWikidataLabels(referencedIds).catch((err) => {
        console.error("[game-provider] Wikidata labels failed:", err);
        return new Map<string, string>();
      })
    : new Map<string, string>();

  const pages = candidatePages
    .filter((p) => {
      const qid = p.pageprops?.wikibase_item;
      return isGamePage(p, qid ? details.get(qid) : undefined, labels);
    })
    .slice(0, MAX_RESULTS);

  // Resolve box art via images + imageinfo — this catches non-free box art
  // that pageimages skips. pageimages thumbnails are kept as a fallback.
  const candidatesPerPage = pages.map(artCandidates);
  const toResolve = [...new Set(candidatesPerPage.flat())].slice(0, 50);
  const imageInfo = toResolve.length
    ? await fetchImageInfo(toResolve).catch((err) => {
        console.error("[game-provider] Wikipedia imageinfo failed:", err);
        return new Map<string, WikiImageInfo>();
      })
    : new Map<string, WikiImageInfo>();

  // Map results back to raw article titles for the REST fallback below.
  const articleTitleByKey = new Map<string, string>();
  for (const p of pages) {
    articleTitleByKey.set(
      `wikipedia:${p.pageid ?? p.pageprops?.wikibase_item ?? p.title ?? ""}`,
      p.title ?? "",
    );
  }

  const results = pages.flatMap((p, i): GameSearchResult[] => {
    const title = cleanWikipediaTitle(p.title ?? "");
    if (!title) return [];
    const qid = p.pageprops?.wikibase_item;
    const d = qid ? details.get(qid) : undefined;
    const art = pickArt(candidatesPerPage[i], imageInfo);
    const pageThumb = p.thumbnail?.source ?? null;
    const pageOriginal = p.original?.source ?? null;
    const coverUrl = art?.thumbUrl ?? art?.url ?? pageThumb ?? null;
    const heroUrl = art?.url ?? pageOriginal ?? coverUrl;
    const developer =
      d?.developerIds.map((id) => labels.get(id)).find(Boolean) ?? null;
    const publisher =
      d?.publisherIds.map((id) => labels.get(id)).find(Boolean) ?? null;
    return [
      {
        externalId: `wikipedia:${p.pageid ?? qid ?? title}`,
        source: "wikipedia",
        title,
        coverUrl,
        heroUrl,
        summary: p.extract?.trim() || p.description?.trim() || null,
        developer,
        publisher,
        genres: [],
        platforms: d
          ? shortPlatforms(d.platformIds.map((id) => labels.get(id)))
          : [],
        releaseYear: d?.year ?? null,
        releaseDate: d?.date ?? null,
        criticScore: null,
      } satisfies GameSearchResult,
    ];
  });

  // Last-resort artwork: REST page summary for pages still missing covers.
  await Promise.allSettled(
    results
      .filter((r) => !r.coverUrl)
      .slice(0, 8)
      .map(async (r) => {
        const art = await fetchRestSummaryArt(
          articleTitleByKey.get(r.externalId) ?? r.title,
        );
        if (art.coverUrl) {
          r.coverUrl = art.coverUrl;
          r.heroUrl = r.heroUrl ?? art.heroUrl;
        }
      }),
  );

  return results;
}

// -------------------------------------------------------------- Merge -----

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function mergeOne(
  target: GameSearchResult,
  source: GameSearchResult,
): void {
  target.coverUrl = target.coverUrl ?? source.coverUrl;
  target.heroUrl = target.heroUrl ?? source.heroUrl;
  target.summary = target.summary ?? source.summary;
  target.developer = target.developer ?? source.developer;
  target.publisher = target.publisher ?? source.publisher;
  if (target.genres.length === 0 && source.genres.length > 0) {
    target.genres = source.genres;
  }
  if (target.platforms.length === 0 && source.platforms.length > 0) {
    target.platforms = source.platforms;
  }
  target.releaseYear = target.releaseYear ?? source.releaseYear;
  target.releaseDate = target.releaseDate ?? source.releaseDate;
  target.criticScore = target.criticScore ?? source.criticScore;
}

/**
 * Interleave the two ranked lists (Wikipedia first for console coverage, then
 * Steam), de-duplicating by normalised title. When the same game appears in
 * both, the surviving entry is back-filled with any missing fields from the
 * other source.
 */
function mergeResults(
  wikipedia: GameSearchResult[],
  steam: GameSearchResult[],
): GameSearchResult[] {
  const byKey = new Map<string, GameSearchResult>();
  const order: string[] = [];
  const add = (r: GameSearchResult) => {
    const key = normalizeTitle(r.title);
    if (!key) return;
    const existing = byKey.get(key);
    if (existing) {
      mergeOne(existing, r);
      return;
    }
    byKey.set(key, { ...r });
    order.push(key);
  };

  let i = 0;
  let j = 0;
  while (i < wikipedia.length || j < steam.length) {
    if (i < wikipedia.length) add(wikipedia[i++]);
    if (j < steam.length) add(steam[j++]);
  }
  return order.map((k) => byKey.get(k)!).slice(0, MAX_RESULTS);
}

// ---------------------------------------------------------------- API -----

export async function searchGames(query: string): Promise<SearchResponse> {
  const q = query.trim();
  if (!q) return { results: [], provider: null };

  const [wikiSettled, steamSettled] = await Promise.allSettled([
    searchWikipedia(q),
    searchSteam(q),
  ]);

  if (wikiSettled.status === "rejected") {
    console.error("[game-provider] Wikipedia failed:", wikiSettled.reason);
  }
  if (steamSettled.status === "rejected") {
    console.error("[game-provider] Steam failed:", steamSettled.reason);
  }

  const wikiResults =
    wikiSettled.status === "fulfilled" ? wikiSettled.value : [];
  const steamResults =
    steamSettled.status === "fulfilled" ? steamSettled.value : [];

  const results = mergeResults(wikiResults, steamResults);
  const provider =
    results.length === 0
      ? null
      : results.some((r) => r.source === "wikipedia")
        ? "wikipedia"
        : "steam";
  return { results, provider };
}
