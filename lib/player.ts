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
  const rows = await sql<PlayerData[]>`
    SELECT p.id, p.name, p.fide_id, p.federation, p.title, p.birth_year, p.death_year,
           (SELECT COALESCE(SUM(gc), 0) FROM (
             SELECT game_count AS gc FROM opponents WHERE player_a_id = ${id}
             UNION ALL
             SELECT game_count AS gc FROM opponents WHERE player_b_id = ${id}
           ) _g)::int AS total_games
    FROM players p
    WHERE p.id = ${id}
  `;
  if (rows.length === 0) return null;
  return rows[0];
}

export async function getTopNeighbors(id: bigint | number, limit = 5): Promise<NeighborData[]> {
  const sql = getDb();
  // Two-branch UNION ALL so each branch uses its dedicated index:
  //   idx_opponents_a (player_a_id) and idx_opponents_b (player_b_id)
  const rows = await sql<NeighborData[]>`
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
  // Step 1: index scan on slug to get the id as BigInt (CockroachDB INT8).
  // Do NOT convert to Number — unique_rowid values exceed MAX_SAFE_INTEGER and
  // would lose precision, causing the WHERE p.id = <wrong number> to miss the row.
  const idRow = await sql<{ id: bigint }[]>`
    SELECT id FROM players WHERE slug = ${slug} LIMIT 1
  `;
  if (idRow.length === 0) return null;
  const id = idRow[0].id; // BigInt — pass directly to SQL template literals

  // Step 2: fetch full player data. Use id (BigInt) in both WHERE and subquery
  // so CockroachDB receives the exact 64-bit integer value.
  const rows = await sql<PlayerData[]>`
    SELECT p.id, p.name, p.fide_id, p.federation, p.title, p.birth_year, p.death_year,
           (SELECT COALESCE(SUM(gc), 0) FROM (
             SELECT game_count AS gc FROM opponents WHERE player_a_id = ${id}
             UNION ALL
             SELECT game_count AS gc FROM opponents WHERE player_b_id = ${id}
           ) _g)::int AS total_games
    FROM players p
    WHERE p.id = ${id}
  `;
  if (rows.length === 0) return null;
  return rows[0];
}
