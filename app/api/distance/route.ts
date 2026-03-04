import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scrapeFidePlayer } from "@/lib/fide-scraper";
import { findShortestPath } from "@/lib/bfs";
import type { TimeControlFilter } from "@/lib/bfs";

export async function GET(request: NextRequest) {
  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  const tcParam = request.nextUrl.searchParams.get("tc");

  if (!fromParam || !toParam) {
    return NextResponse.json(
      { error: "Both 'from' and 'to' query parameters are required" },
      { status: 400 }
    );
  }

  const fromId = parseInt(fromParam, 10);
  const toId = parseInt(toParam, 10);

  if (isNaN(fromId) || isNaN(toId)) {
    return NextResponse.json(
      { error: "'from' and 'to' must be valid player IDs" },
      { status: 400 }
    );
  }

  const tcFilter: TimeControlFilter =
    tcParam === "classical" ? "classical" : "all";

  // On-demand FIDE scraping: if either player has a FIDE ID but hasn't been
  // scraped yet, fetch their opponents now before running BFS.
  // Wrapped in try/catch so a missing fide_scraped_at column doesn't break the route.
  const sql = getDb();
  try {
    const [fromRows, toRows] = await Promise.all([
      sql<{ fide_id: number | null; fide_scraped_at: Date | null }[]>`
        SELECT fide_id, fide_scraped_at FROM players WHERE id = ${fromId}
      `,
      sql<{ fide_id: number | null; fide_scraped_at: Date | null }[]>`
        SELECT fide_id, fide_scraped_at FROM players WHERE id = ${toId}
      `,
    ]);

    for (const rows of [fromRows, toRows]) {
      const p = rows[0];
      if (p?.fide_id && !p.fide_scraped_at) {
        // Fire-and-forget: do not block the response waiting for FIDE scraping.
        // The path result uses whatever data is already in the DB; the next
        // request (after cache TTL expires) will include the newly scraped games.
        const fideId = p.fide_id;
        scrapeFidePlayer(Number(fideId), sql)
          .then(() => {
            console.log(`[distance] Background scrape done for FIDE ${fideId}`);
          })
          .catch((err) => {
            console.warn(`[distance] Background scrape failed for FIDE ${fideId}:`, err);
          });
        // Mark as scraped immediately so we don't re-trigger on the next request.
        try {
          await sql`UPDATE players SET fide_scraped_at = NOW() WHERE fide_id = ${fideId}`;
        } catch {
          // fide_scraped_at column may not exist yet — ignore
        }
      }
    }
  } catch {
    // fide_scraped_at column may not exist yet — skip scraping
  }

  const result = await findShortestPath(fromId, toId, tcFilter);

  if (!result) {
    const error =
      tcFilter === "classical"
        ? "No path found through classical games only. Try disabling the filter."
        : "No path found between these players";
    return NextResponse.json({ error, tcFiltered: tcFilter === "classical" }, { status: 404 });
  }

  return NextResponse.json(result);
}
