import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export type { GameStatus } from "@/lib/types";
import type { GameStatus } from "@/lib/types";

export const libraryGames = pgTable(
  "library_games",
  {
    id: serial("id").primaryKey(),

    // ---- Game metadata (sourced from IGDB / RAWG / Steam) ----
    externalId: text("external_id").unique(),
    source: text("source").default("manual"),
    title: text("title").notNull(),
    coverUrl: text("cover_url"),
    heroUrl: text("hero_url"),
    summary: text("summary"),
    developer: text("developer"),
    publisher: text("publisher"),
    genres: text("genres").array().default([]),
    platforms: text("platforms").array().default([]),
    releaseYear: integer("release_year"),
    releaseDate: text("release_date"),
    criticScore: integer("critic_score"),

    // ---- Personal library data ----
    status: text("status").$type<GameStatus>().notNull().default("backlog"),
    rating: integer("rating"), // personal score 1–10
    hoursPlayed: integer("hours_played"),
    platform: text("platform"), // the console you play it on
    notes: text("notes"),
    favorite: boolean("favorite").notNull().default(false),
    addedAt: timestamp("added_at", { mode: "string" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    index("library_games_title_idx").on(table.title),
    index("library_games_status_idx").on(table.status),
  ],
);

export type LibraryGame = typeof libraryGames.$inferSelect;
export type NewLibraryGame = typeof libraryGames.$inferInsert;
