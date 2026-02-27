/**
 * migrate-add-indexes.js
 *
 * Adds partial indexes on players(birth_year) and players(death_year) to speed
 * up the chronological edge-filtering JOIN in find_chess_path() and any future
 * ad-hoc queries against dated players.
 *
 * The BFS traversal indexes (idx_opponents_a, idx_opponents_b) are already
 * defined in schema.sql and do not need to be recreated here.
 *
 * Safe to re-run (uses IF NOT EXISTS).
 *
 * Usage:
 *   DATABASE_URL=... node scripts/migrate-add-indexes.js
 */

const { neon } = require("@neondatabase/serverless");

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("No DATABASE_URL"); process.exit(1); }
const sql = neon(DB_URL);

async function main() {
  console.log("Adding chronological indexes to players table...");

  // Partial index — only rows that actually have a birth year (most modern players).
  // Used when checking pB.birth_year > pA.death_year during BFS expansion.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_players_birth_year
    ON players(birth_year)
    WHERE birth_year IS NOT NULL
  `;
  console.log("  ✓ idx_players_birth_year");

  // Partial index — only historical players who have died.
  // Used when checking pA.death_year < pB.birth_year.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_players_death_year
    ON players(death_year)
    WHERE death_year IS NOT NULL
  `;
  console.log("  ✓ idx_players_death_year");

  console.log("\nDone. Existing BFS indexes (idx_opponents_a/b) were already present.");
}

main().catch(console.error);
