import { getDb } from "./db";

export interface NeighborData {
  id: number;
  name: string;
  title: string | null;
  federation: string | null;
  game_count: number;
  slug: string | null;
}

export interface PlayerData {
  id: number;
  name: string;
  fide_id: number | null;
  federation: string | null;
  title: string | null;
  birth_year: number | null;
  death_year: number | null;
  total_games: number | null;
}

export async function getPlayerData(id: number): Promise<PlayerData | null> {
  const sql = getDb();
  const rows = await sql<PlayerData[]>
    `
    SELECT p.id,p.name,p.fide_id,p.federation,p.title,p.birth_year,p.death_year,
           (SELECT SUM(game_count) FROM opponents
            WHERE player_a_id = ${id} OR player_b_id = ${id})::int AS total_games
    FROM players p
    WHERE p.id = ${id}
  `;
  if (rows.length === 0) return null;
  return rows[0];
}

export async function getTopNeighbors(id: number, limit = 5): Promise<NeighborData[]> {
  const sql = getDb();
  // Two-branch UNION ALL so each branch uses its dedicated index:
  //   idx_opponents_a (player_a_id) and idx_opponents_b (player_b_id)
  // A CASE expression in the JOIN would prevent index usage (full scan).
  const rows = await sql<NeighborData[]>
    `
    SELECT p.id, p.name, p.title, p.federation, o.game_count, p.slug
    FROM opponents o
    JOIN players p ON p.id = o.player_b_id
    WHERE o.player_a_id = ${id}
    UNION ALL
    SELECT p.id, p.name, p.title, p.federation, o.game_count, p.slug
    FROM opponents o
    JOIN players p ON p.id = o.player_a_id
    WHERE o.player_b_id = ${id}
    ORDER BY game_count DESC
    LIMIT ${limit}
  `;
  return rows;
}

export async function getPlayerBySlug(slug: string): Promise<PlayerData | null> {
  const sql = getDb();
  const rows = await sql<PlayerData[]>
    `
    SELECT p.id,p.name,p.fide_id,p.federation,p.title,p.birth_year,p.death_year,
           (SELECT SUM(game_count) FROM opponents
            WHERE player_a_id = p.id OR player_b_id = p.id)::int AS total_games
    FROM players p
    WHERE p.slug = ${slug}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rows[0];
}
