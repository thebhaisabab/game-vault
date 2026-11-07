import { searchGames } from "@/lib/game-provider";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";

  if (q.length < 2) {
    return Response.json({ results: [], provider: null });
  }

  try {
    const data = await searchGames(q);
    return Response.json(data);
  } catch (err) {
    console.error("[api/games/search]", err);
    return Response.json({ error: "search_failed" }, { status: 502 });
  }
}
