import { db } from "@/db";
import { libraryGames, type LibraryGame } from "@/db/schema";
import { desc } from "drizzle-orm";
import LibraryApp from "@/components/library-app";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let initialGames: LibraryGame[] = [];
  try {
    initialGames = await db
      .select()
      .from(libraryGames)
      .orderBy(desc(libraryGames.addedAt));
  } catch (err) {
    console.error("[page] failed to load library:", err);
  }

  return <LibraryApp initialGames={initialGames} />;
}
