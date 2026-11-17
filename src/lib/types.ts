export type GameStatus =
  | "playing"
  | "completed"
  | "backlog"
  | "wishlist"
  | "paused"
  | "dropped";

export type GameProviderId = "steam" | "wikipedia" | "manual";

export interface GameSearchResult {
  externalId: string;
  source: GameProviderId;
  title: string;
  coverUrl: string | null;
  heroUrl: string | null;
  summary: string | null;
  developer: string | null;
  publisher: string | null;
  genres: string[];
  platforms: string[];
  releaseYear: number | null;
  releaseDate: string | null;
  criticScore: number | null; // normalized 0–100
}

export interface SearchResponse {
  results: GameSearchResult[];
  provider: GameProviderId | null;
}

// ---------------------------------------------------- Co-Op Vault ----------
export type CoOpStatus = "wishlist" | "bought";

/** Optional co-op mode tags shown on co-op vault cards. */
export const COOP_TAGS = [
  "Couch Co-Op",
  "Split-Screen",
  "Online Co-Op",
  "Pass the Controller",
] as const;
export type CoOpTag = (typeof COOP_TAGS)[number];
