import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { StatsData } from "@/lib/types";

export async function GET() {
  const sql = getDb();

  const [playerCount] = await sql`SELECT COUNT(*) as count FROM players`;
  const [pairCount] = await sql`SELECT COUNT(*) as count FROM opponents`;
  const [gameSum] = await sql`SELECT COALESCE(SUM(game_count), 0) as total FROM opponents`;

  const stats: StatsData = {
    total_players: Number(playerCount.count),
    total_opponent_pairs: Number(pairCount.count),
    total_games: Number(gameSum.total),
    last_updated: null,
  };

  return NextResponse.json(stats);
}
