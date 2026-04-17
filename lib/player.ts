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

export async function getPlayerData(id: bigint | number | string): Promise<PlayerData | null> {
  const sql = getDb();
  // CockroachDB unique_rowid values exceed Number.MAX_SAFE_INTEGER. Callers may
  // pass a BigInt (from another query), a string (from a URL path), or a small
  // number (from tests). Normalize to BigInt so postgres.js sends int8 on the wire
  // without precision loss; cast to `unknown as number` only to satisfy TS.
  const bigId = typeof id === "bigint" ? id : BigInt(id);
  const idParam = bigId as unknown as number;
  const rows = await sql<PlayerData[]>`
    SELECT p.id, p.name, p.fide_id, p.federation, p.title, p.birth_year, p.death_year,
           (SELECT COALESCE(SUM(gc), 0) FROM (
             SELECT game_count AS gc FROM opponents WHERE player_a_id = ${idParam}
             UNION ALL
             SELECT game_count AS gc FROM opponents WHERE player_b_id = ${idParam}
           ) _g)::int AS total_games
    FROM players p
    WHERE p.id = ${idParam}
  `;
  if (rows.length === 0) return null;
  return rows[0];
}

export async function getTopNeighbors(id: bigint | number, limit = 5): Promise<NeighborData[]> {
  const sql = getDb();
  // postgres.js types don't include bigint in SerializableParameter, but the driver
  // handles it correctly at runtime (sends int8 OID on the wire). Cast via unknown to
  // satisfy TypeScript without converting to Number (which would lose precision).
  const pgId = BigInt(id) as unknown as number;
  // Two-branch UNION ALL so each branch uses its dedicated index:
  //   idx_opponents_a (player_a_id) and idx_opponents_b (player_b_id)
  // TypeScript cast: postgres.js checks typeof at runtime (sees bigint → int8),
  // but the TS type system rejects mixing bigint + number in the same sql<T> template.
  // Casting to `unknown as number` is a TypeScript-only lie; the runtime value stays bigint.
  const pgIdParam = pgId as unknown as number;
  const rows = await sql<NeighborData[]>`
    SELECT p.id, p.name, p.title, p.federation, o.game_count, p.slug
    FROM opponents o
    JOIN players p ON p.id = o.player_b_id
    WHERE o.player_a_id = ${pgIdParam}
    UNION ALL
    SELECT p.id, p.name, p.title, p.federation, o.game_count, p.slug
    FROM opponents o
    JOIN players p ON p.id = o.player_a_id
    WHERE o.player_b_id = ${pgIdParam}
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
  // TypeScript-only cast: postgres.js checks typeof at runtime (bigint → int8 wire type),
  // but sql<T> template types reject mixing bigint with the generic parameter in TS 5.5+.
  const idParam = id as unknown as number;

  // Step 2: fetch full player data. Use id (BigInt) in both WHERE and subquery
  // so CockroachDB receives the exact 64-bit integer value.
  const rows = await sql<PlayerData[]>`
    SELECT p.id, p.name, p.fide_id, p.federation, p.title, p.birth_year, p.death_year,
           (SELECT COALESCE(SUM(gc), 0) FROM (
             SELECT game_count AS gc FROM opponents WHERE player_a_id = ${idParam}
             UNION ALL
             SELECT game_count AS gc FROM opponents WHERE player_b_id = ${idParam}
           ) _g)::int AS total_games
    FROM players p
    WHERE p.id = ${idParam}
  `;
  if (rows.length === 0) return null;
  return rows[0];
}
