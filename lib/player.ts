import { getDb } from "./db";

export interface PlayerData {
  id: number;
  name: string;
  fide_id: number | null;
  federation: string | null;
  birth_year: number | null;
  death_year: number | null;
  total_games: number | null;
}

export async function getPlayerData(id: number): Promise<PlayerData | null> {
  const sql = getDb();
  const rows = await sql<PlayerData[]>
    `
    SELECT p.id,p.name,p.fide_id,p.federation,p.birth_year,p.death_year,
           (SELECT SUM(game_count) FROM opponents
            WHERE player_a_id = ${id} OR player_b_id = ${id})::int AS total_games
    FROM players p
    WHERE p.id = ${id}
  `;
  if (rows.length === 0) return null;
  return rows[0];
}
