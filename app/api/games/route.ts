import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  const aParam = request.nextUrl.searchParams.get("a");
  const bParam = request.nextUrl.searchParams.get("b");

  if (!aParam || !bParam) {
    return NextResponse.json({ error: "Both 'a' and 'b' are required" }, { status: 400 });
  }

  const idA = parseInt(aParam, 10);
  const idB = parseInt(bParam, 10);
  if (isNaN(idA) || isNaN(idB)) {
    return NextResponse.json({ error: "Invalid player IDs" }, { status: 400 });
  }

  const [sId, bId] = idA < idB ? [idA, idB] : [idB, idA];
  const sql = getDb();

  const rows = await sql`
    SELECT o.game_count, o.first_game_date, o.last_game_date,
           o.classical_count, o.rapid_count, o.blitz_count, o.event_sample,
           pa.name as player_a_name, pa.title as player_a_title,
           pb.name as player_b_name, pb.title as player_b_title
    FROM opponents o
    JOIN players pa ON pa.id = o.player_a_id
    JOIN players pb ON pb.id = o.player_b_id
    WHERE o.player_a_id = ${sId} AND o.player_b_id = ${bId}
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "No games found" }, { status: 404 });
  }

  const row = rows[0];
  return NextResponse.json({
    game_count: row.game_count,
    first_game_date: row.first_game_date,
    last_game_date: row.last_game_date,
    classical_count: row.classical_count ?? 0,
    rapid_count: row.rapid_count ?? 0,
    blitz_count: row.blitz_count ?? 0,
    event_sample: row.event_sample ?? null,
    player_a: { name: row.player_a_name, title: row.player_a_title },
    player_b: { name: row.player_b_name, title: row.player_b_title },
  });
}
