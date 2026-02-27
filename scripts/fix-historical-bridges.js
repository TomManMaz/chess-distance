/**
 * fix-historical-bridges.js
 *
 * Detects and removes "false bridge" opponent pairs — edges where:
 *   1. One player has a known death_year (historical player)
 *   2. The edge has no game date (null first_game_date)
 *   3. The other player has modern dated games more than 80 years after the
 *      historical player died — proving it's a different person sharing the
 *      same abbreviated name.
 *
 * The 80-year cutoff only fires for very old figures:
 *   Morphy d.1884 → cutoff 1964  (Reti d.1929 → cutoff 2009)
 * and never for 20th-century masters:
 *   Tal d.1992 → cutoff 2072 (never reached)
 *
 * Usage:
 *   DATABASE_URL=... node scripts/fix-historical-bridges.js          # dry run
 *   DATABASE_URL=... node scripts/fix-historical-bridges.js --fix    # delete pairs
 */

const { neon } = require("@neondatabase/serverless");

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("No DATABASE_URL"); process.exit(1); }
const sql = neon(DB_URL);

const FIX = process.argv.includes("--fix");

async function main() {
  // All historical players with a known death year
  const historical = await sql`
    SELECT id, name, death_year FROM players
    WHERE death_year IS NOT NULL
    ORDER BY death_year
  `;
  console.log(`Checking ${historical.length} historical players for false bridges...\n`);

  const toDelete = [];

  for (const hist of historical) {
    // Their null-date opponent pairs
    const nullEdges = await sql`
      SELECT
        o.player_a_id, o.player_b_id,
        o.event_sample,
        CASE WHEN o.player_a_id = ${hist.id} THEN pb.id   ELSE pa.id   END AS opp_id,
        CASE WHEN o.player_a_id = ${hist.id} THEN pb.name ELSE pa.name END AS opp_name,
        CASE WHEN o.player_a_id = ${hist.id} THEN pb.birth_year ELSE pa.birth_year END AS opp_birth,
        CASE WHEN o.player_a_id = ${hist.id} THEN pb.death_year ELSE pa.death_year END AS opp_death
      FROM opponents o
      JOIN players pa ON pa.id = o.player_a_id
      JOIN players pb ON pb.id = o.player_b_id
      WHERE (o.player_a_id = ${hist.id} OR o.player_b_id = ${hist.id})
        AND o.first_game_date IS NULL
    `;

    for (const edge of nullEdges) {
      // Skip if the opponent already has a death year (clearly another historical player)
      if (edge.opp_death !== null) continue;

      // Check: opponent has dated games more than 80 years after the historical
      // player died. 80 years is beyond any plausible chess career, so this only
      // fires for very old figures (Morphy d.1884→cutoff 1964, Reti d.1929→2009)
      // and never for 20th-century masters (Tal d.1992→2072, never reached).
      const cutoff = `${hist.death_year + 80}-01-01`;
      const [{ cnt }] = await sql`
        SELECT COUNT(*) AS cnt
        FROM opponents o2
        WHERE (o2.player_a_id = ${edge.opp_id} OR o2.player_b_id = ${edge.opp_id})
          AND o2.first_game_date > ${cutoff}
      `;

      if (parseInt(cnt) > 0) {
        toDelete.push({
          hist_name: hist.name,
          hist_death: hist.death_year,
          opp_name: edge.opp_name,
          reason: `has games after ${hist.death_year + 80}`,
          event: edge.event_sample,
          a_id: edge.player_a_id,
          b_id: edge.player_b_id,
        });
      }
    }
  }

  if (toDelete.length === 0) {
    console.log("No false bridges found.");
    return;
  }

  console.log(`Found ${toDelete.length} false bridge(s):\n`);
  for (const d of toDelete) {
    console.log(`  ⚠️  ${d.hist_name} (d.${d.hist_death}) ↔ ${d.opp_name}  [${d.event}]`);
  }

  if (!FIX) {
    console.log("\nDry run — run with --fix to delete these pairs.");
    return;
  }

  console.log("\nDeleting...");
  for (const d of toDelete) {
    await sql`
      DELETE FROM opponents
      WHERE player_a_id = ${d.a_id} AND player_b_id = ${d.b_id}
    `;
    console.log(`  Deleted: ${d.hist_name} ↔ ${d.opp_name}`);
  }
  console.log(`\nDone. ${toDelete.length} false bridge(s) removed.`);
}

main().catch(console.error);
