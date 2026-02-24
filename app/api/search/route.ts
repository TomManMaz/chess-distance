import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { SearchResult } from "@/lib/types";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 2) {
    return NextResponse.json([]);
  }

  const sql = getDb();
  const query = q.trim();

  const rows = await sql`
    SELECT id, name, title, federation
    FROM players
    WHERE name % ${query}
    ORDER BY
      similarity(name, ${query}) DESC,
      (fide_id IS NOT NULL) DESC,   -- FIDE-verified players first on ties
      length(name) DESC              -- longer (more complete) names before abbreviations
    LIMIT 10
  `;

  const results: SearchResult[] = rows.map((row) => ({
    id: row.id as number,
    name: row.name as string,
    title: row.title as string | null,
    federation: row.federation as string | null,
  }));

  return NextResponse.json(results);
}
