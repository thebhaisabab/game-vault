import type { Metadata } from "next";
import { desc } from "drizzle-orm";

import { db } from "@/db";
import { coOpGames, type CoOpGame } from "@/db/schema";
import { ensureCoOpTable } from "@/lib/co-op";
import CoOpVault from "@/components/co-op-vault";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Player Two · Co-Op Vault — Sabab Plays",
  description:
    "The games Player 1 & Player 2 bought together and the ones we're dreaming about — synced for the couch, for date night, for two.",
};

export default async function CoOpPage() {
  let initialGames: CoOpGame[] = [];
  let dbOk = true;
  try {
    await ensureCoOpTable();
    initialGames = await db
      .select()
      .from(coOpGames)
      .orderBy(desc(coOpGames.createdAt));
  } catch (err) {
    console.error("[co-op] failed to load co-op vault:", err);
    dbOk = false;
  }

  return <CoOpVault initialGames={initialGames} initialDbOk={dbOk} />;
}
