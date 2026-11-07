import type { GameStatus } from "./types";

export const STATUS_META: Record<GameStatus, { label: string; color: string }> = {
  playing: { label: "Playing", color: "#c8ff3e" },
  completed: { label: "Completed", color: "#4dd6ff" },
  backlog: { label: "Backlog", color: "#9a9aa6" },
  wishlist: { label: "Wishlist", color: "#9d7bff" },
  paused: { label: "Paused", color: "#ffb84d" },
  dropped: { label: "Dropped", color: "#ff5c5c" },
};

export const STATUS_ORDER: GameStatus[] = [
  "playing",
  "completed",
  "backlog",
  "wishlist",
  "paused",
  "dropped",
];

export type LibraryView = "grid" | "list" | "showcase";

export type SortId =
  | "added_desc"
  | "added_asc"
  | "title_asc"
  | "release_desc"
  | "release_asc"
  | "rating_desc"
  | "score_desc";

export const SORT_OPTIONS: { id: SortId; label: string }[] = [
  { id: "added_desc", label: "Recently added" },
  { id: "added_asc", label: "First added" },
  { id: "title_asc", label: "Title A–Z" },
  { id: "release_desc", label: "Newest releases" },
  { id: "release_asc", label: "Oldest releases" },
  { id: "rating_desc", label: "Your rating" },
  { id: "score_desc", label: "Critics' score" },
];

export const PLATFORM_SUGGESTIONS = [
  "PS5",
  "PS4",
  "Xbox Series X|S",
  "Xbox One",
  "Switch",
  "Switch 2",
  "PC",
  "Mac",
  "Linux",
  "PS3",
  "Xbox 360",
  "Wii U",
  "GameCube",
  "3DS",
  "iOS",
  "Android",
  "Other",
];

/** Brand-tinted dot color for a platform label. */
export function platformTone(label: string): string {
  const l = label.toLowerCase();
  if (/playstation|^ps|psp|vita/.test(l)) return "#4d8dff";
  if (/xbox/.test(l)) return "#3ddc5b";
  if (/switch|wii|gamecube|n64|3ds|game boy|gba|snes|nes|nintendo|ds\b/.test(l))
    return "#ff5a5a";
  if (/\bpc\b|windows|steam|linux|mac/.test(l)) return "#c8ff3e";
  if (/ios|android|mobile/.test(l)) return "#9d7bff";
  return "#9a9aa6";
}

export function formatGames(n: number): string {
  return n === 1 ? "1 title" : `${n} titles`;
}

export function formatAdded(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Deterministic pleasant gradient for covers that have no art. */
export function titleGradient(title: string): string {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) % 360;
  const h2 = (h + 48) % 360;
  return `linear-gradient(160deg, hsl(${h} 62% 26%), hsl(${h2} 72% 12%))`;
}
