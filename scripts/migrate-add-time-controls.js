/**
 * migrate-add-time-controls.js
 *
 * One-time migration: add classical_count, rapid_count, blitz_count, event_sample
 * columns to the opponents table.
 *
 * For existing rows (before ETL is re-run), sets classical_count = game_count
 * as a conservative assumption (historical games with no TimeControl header
 * are treated as classical).
 *
 * Usage:
 *   DATABASE_URL=... node scripts/migrate-add-time-controls.js
 *
 * After running this, re-run the ETL to populate TC counts accurately:
 *   node scripts/load-historical.js
 *   node scripts/batch-pairs.js
 */

const { neon } = require("@neondatabase/serverless");

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("No DATABASE_URL"); process.exit(1); }
const sql = neon(DB_URL);

async function main() {
  console.log("Adding time control columns to opponents table...");

  await sql`ALTER TABLE opponents ADD COLUMN IF NOT EXISTS classical_count INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE opponents ADD COLUMN IF NOT EXISTS rapid_count INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE opponents ADD COLUMN IF NOT EXISTS blitz_count INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE opponents ADD COLUMN IF NOT EXISTS event_sample TEXT`;

  console.log("  Columns added.");

  // Seed classical_count = game_count for existing rows so the "classical only"
  // toggle still works before the ETL is re-run.
  const res = await sql`
    UPDATE opponents
    SET classical_count = game_count
    WHERE classical_count = 0 AND rapid_count = 0 AND blitz_count = 0
  `;
  console.log(`  Seeded classical_count for ${res.count ?? "unknown"} existing rows.`);

  const stats = await sql`SELECT count(*) AS n FROM opponents`;
  console.log(`  Total opponent pairs: ${stats[0].n}`);
  console.log("Done.");
}

main().catch(console.error);
