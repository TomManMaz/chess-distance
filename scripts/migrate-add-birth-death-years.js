/**
 * migrate-add-birth-death-years.js
 *
 * Adds birth_year and death_year columns to the players table.
 * Safe to run multiple times (uses IF NOT EXISTS).
 *
 * Usage:
 *   DATABASE_URL=... node scripts/migrate-add-birth-death-years.js
 */

const postgres = require("postgres");

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("No DATABASE_URL"); process.exit(1); }
const sql = postgres(DB_URL, { max: 1 });

async function main() {
  console.log("Adding birth_year and death_year columns to players table...");

  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS birth_year SMALLINT`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS death_year SMALLINT`;

  console.log("Done. Columns added (or already existed).");
  console.log("\nNext steps:");
  console.log("  node scripts/set-historical-dates.js   # set death years for historical players");
  console.log("  node scripts/download-fide-xml.js      # re-run to populate birth_year from FIDE XML");
}

main().catch(console.error);
