#!/usr/bin/env node
/**
 * Migration: add fide_scraped_at column to players table.
 * Run once: DATABASE_URL=... node scripts/migrate-add-fide-scraped-at.js
 */

const postgres = require("postgres");

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

async function main() {
  console.log("Adding fide_scraped_at column to players...");
  await sql`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS fide_scraped_at TIMESTAMPTZ DEFAULT NULL
  `;
  console.log("Done.");
  await sql.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
