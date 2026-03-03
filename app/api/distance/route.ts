import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scrapeFidePlayer } from "@/lib/fide-scraper";
import { findShortestPath, invalidateCache } from "@/lib/bfs";
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
  const sql = getDb();
  const [fromRows, toRows] = await Promise.all([
    sql<{ fide_id: number | null; fide_scraped_at: Date | null }[]>`
      SELECT fide_id, fide_scraped_at FROM players WHERE id = ${fromId}
    `,
    sql<{ fide_id: number | null; fide_scraped_at: Date | null }[]>`
      SELECT fide_id, fide_scraped_at FROM players WHERE id = ${toId}
    `,
  ]);

  let scraped = false;
  for (const rows of [fromRows, toRows]) {
    const p = rows[0];
    if (p?.fide_id && !p.fide_scraped_at) {
      try {
        await Promise.race([
          scrapeFidePlayer(Number(p.fide_id), sql).then(() => {
            scraped = true;
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("scrape timeout")), 50_000)
          ),
        ]);
      } catch (err) {
        // Timeout or FIDE unreachable — mark scraped anyway to prevent infinite retries,
        // then continue with whatever data we have.
        const fideId = p.fide_id;
        console.warn(`[distance] Scrape for FIDE ${fideId} failed/timed out:`, err);
        try {
          await sql`UPDATE players SET fide_scraped_at = NOW() WHERE fide_id = ${fideId}`;
          scraped = true; // partial data may still have been inserted
        } catch {
          // DB update failed — don't mark scraped; allow retry next request
        }
      }
    }
  }

  if (scraped) invalidateCache();

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
