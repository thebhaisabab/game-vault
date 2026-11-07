import type { GameSearchResult, SearchResponse } from "./types";

/**
 * Game search provider chain:
 *   1. IGDB  — best coverage of every console (set IGDB_CLIENT_ID / IGDB_CLIENT_SECRET,
 *              Twitch creds; TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET also accepted)
 *   2. RAWG  — great coverage (set RAWG_API_KEY, free at rawg.io/apidocs)
 *   3. Steam — keyless fallback (PC catalogue)
 */

const PLATFORM_MAP: Record<string, string> = {
  "PC (Microsoft Windows)": "PC",
  "Xbox Series X|S": "Xbox Series X|S",
  "Xbox Series S/X": "Xbox Series X|S",
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
  "Wii": "Wii",
  "Nintendo GameCube": "GameCube",
  "Nintendo 64": "N64",
  "Nintendo 3DS": "3DS",
  "Nintendo DS": "DS",
  "Game Boy Advance": "GBA",
  "Game Boy Color": "Game Boy Color",
  "Game Boy": "Game Boy",
  "Super Nintendo Entertainment System": "SNES",
  "Nintendo Entertainment System": "NES",
  "Sega Mega Drive/Genesis": "Genesis",
  "Web browser": "Web",
  "Xbox One": "Xbox One",
  "Xbox 360": "Xbox 360",
  Xbox: "Xbox",
  Mac: "Mac",
  Linux: "Linux",
  iOS: "iOS",
  Android: "Android",
  Arcade: "Arcade",
  Dreamcast: "Dreamcast",
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

// ---------------------------------------------------------------- IGDB ----

interface IgdbGame {
  id: number;
  name: string;
  cover?: { image_id?: string };
  artworks?: Array<{ image_id?: string }>;
  screenshots?: Array<{ image_id?: string }>;
  platforms?: Array<{ name?: string }>;
  first_release_date?: number;
  summary?: string;
  genres?: Array<{ name?: string }>;
  involved_companies?: Array<{
    developer?: boolean;
    publisher?: boolean;
    company?: { name?: string };
  }>;
  total_rating?: number;
}

let igdbToken: { value: string; expiresAt: number } | undefined;

async function getIgdbToken(): Promise<string> {
  const clientId = process.env.IGDB_CLIENT_ID ?? process.env.TWITCH_CLIENT_ID;
  const clientSecret =
    process.env.IGDB_CLIENT_SECRET ?? process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("IGDB not configured");

  if (igdbToken && igdbToken.expiresAt > Date.now() + 60_000) {
    return igdbToken.value;
  }
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(
      clientId,
    )}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`,
    { method: "POST", signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) throw new Error(`Twitch OAuth failed (${res.status})`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  igdbToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return igdbToken.value;
}

const igdbImage = (id: string | undefined, size: string) =>
  id ? `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg` : null;

async function searchIgdb(query: string): Promise<GameSearchResult[]> {
  const clientId = process.env.IGDB_CLIENT_ID ?? process.env.TWITCH_CLIENT_ID;
  const token = await getIgdbToken();
  const safe = query.replace(/["\\]/g, " ").slice(0, 120);

  const body = [
    `search "${safe}";`,
    "fields name, cover.image_id, artworks.image_id, screenshots.image_id,",
    "platforms.name, first_release_date, summary, genres.name,",
    "involved_companies.company.name, involved_companies.developer,",
    "involved_companies.publisher, total_rating, category;",
    "where category = (0, 2, 4, 8, 9, 10, 11);",
    "limit 24;",
  ].join(" ");

  const res = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: {
      "Client-ID": clientId!,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
      Accept: "application/json",
    },
    body,
    signal: AbortSignal.timeout(9000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`IGDB search failed (${res.status})`);
  const games = (await res.json()) as IgdbGame[];

  return games.map((g) => {
    const dev = g.involved_companies?.find((c) => c.developer)?.company?.name;
    const pub = g.involved_companies?.find((c) => c.publisher)?.company?.name;
    const heroId = g.artworks?.[0]?.image_id ?? g.screenshots?.[0]?.image_id;
    const ts = g.first_release_date;
    return {
      externalId: `igdb:${g.id}`,
      source: "igdb",
      title: g.name,
      coverUrl: igdbImage(g.cover?.image_id, "cover_big_2x"),
      heroUrl: igdbImage(heroId, "1080p"),
      summary: g.summary ?? null,
      developer: dev ?? null,
      publisher: pub ?? null,
      genres: (g.genres ?? []).map((x) => x.name).filter(Boolean) as string[],
      platforms: shortPlatforms((g.platforms ?? []).map((p) => p.name)),
      releaseYear: ts ? new Date(ts * 1000).getUTCFullYear() : null,
      releaseDate: ts ? new Date(ts * 1000).toISOString().slice(0, 10) : null,
      criticScore:
        typeof g.total_rating === "number" ? Math.round(g.total_rating) : null,
    } satisfies GameSearchResult;
  });
}

// ---------------------------------------------------------------- RAWG ----

interface RawgGame {
  id: number;
  name: string;
  released?: string | null;
  background_image?: string | null;
  rating?: number;
  ratings_count?: number;
  genres?: Array<{ name?: string }>;
  platforms?: Array<{ platform?: { name?: string } }>;
  parent_platforms?: Array<{ platform?: { name?: string } }>;
}

async function searchRawg(query: string): Promise<GameSearchResult[]> {
  const key = process.env.RAWG_API_KEY;
  if (!key) throw new Error("RAWG not configured");
  const url =
    `https://api.rawg.io/api/games?key=${encodeURIComponent(key)}` +
    `&search=${encodeURIComponent(query)}&page_size=24&exclude_additions=true`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(9000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`RAWG search failed (${res.status})`);
  const data = (await res.json()) as { results?: RawgGame[] };

  return (data.results ?? []).map((g) => {
    const platformNames = (g.platforms ?? g.parent_platforms ?? []).map(
      (p) => p.platform?.name,
    );
    const year = g.released ? Number(g.released.slice(0, 4)) : NaN;
    const useRating = (g.ratings_count ?? 0) >= 20;
    return {
      externalId: `rawg:${g.id}`,
      source: "rawg",
      title: g.name,
      coverUrl: g.background_image ?? null,
      heroUrl: g.background_image ?? null,
      summary: null,
      developer: null,
      publisher: null,
      genres: (g.genres ?? []).map((x) => x.name).filter(Boolean) as string[],
      platforms: shortPlatforms(platformNames),
      releaseYear: Number.isFinite(year) ? year : null,
      releaseDate: g.released ?? null,
      criticScore:
        useRating && typeof g.rating === "number" && g.rating > 0
          ? Math.round(g.rating * 20)
          : null,
    } satisfies GameSearchResult;
  });
}

// --------------------------------------------------------------- Steam ----

interface SteamItem {
  id: number;
  name: string;
  metascore?: string;
  platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
}

async function searchSteam(query: string): Promise<GameSearchResult[]> {
  const url =
    `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(
      query,
    )}&l=english&cc=US`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(9000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Steam search failed (${res.status})`);
  const data = (await res.json()) as { items?: SteamItem[] };

  return (data.items ?? [])
    .slice(0, 24)
    .map((g) => {
      const platforms = ["PC"];
      if (g.platforms?.mac) platforms.push("Mac");
      if (g.platforms?.linux) platforms.push("Linux");
      const meta = g.metascore ? Number.parseInt(g.metascore, 10) : NaN;
      return {
        externalId: `steam:${g.id}`,
        source: "steam",
        title: g.name,
        coverUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.id}/library_600x900_2x.jpg`,
        heroUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.id}/library_hero.jpg`,
        summary: null,
        developer: null,
        publisher: null,
        genres: [],
        platforms,
        releaseYear: null,
        releaseDate: null,
        criticScore: Number.isFinite(meta) && meta > 0 ? meta : null,
      } satisfies GameSearchResult;
    });
}

// ---------------------------------------------------------------- API -----

export async function searchGames(query: string): Promise<SearchResponse> {
  const q = query.trim();
  if (!q) return { results: [], provider: null };

  const hasIgdb = Boolean(
    (process.env.IGDB_CLIENT_ID ?? process.env.TWITCH_CLIENT_ID) &&
      (process.env.IGDB_CLIENT_SECRET ?? process.env.TWITCH_CLIENT_SECRET),
  );
  const hasRawg = Boolean(process.env.RAWG_API_KEY);

  if (hasIgdb) {
    try {
      const results = await searchIgdb(q);
      return { results, provider: "igdb" };
    } catch (err) {
      console.error("[game-provider] IGDB failed:", err);
    }
  }

  if (hasRawg) {
    try {
      const results = await searchRawg(q);
      return { results, provider: "rawg" };
    } catch (err) {
      console.error("[game-provider] RAWG failed:", err);
    }
  }

  try {
    const results = await searchSteam(q);
    return { results, provider: "steam" };
  } catch (err) {
    console.error("[game-provider] Steam failed:", err);
  }

  return { results: [], provider: null };
}
