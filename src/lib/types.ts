export type GameStatus =
  | "playing"
  | "completed"
  | "backlog"
  | "wishlist"
  | "paused"
  | "dropped";

export type GameProviderId = "igdb" | "rawg" | "steam" | "manual";

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
