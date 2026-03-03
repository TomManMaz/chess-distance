/**
 * validate-data.js — Find and optionally remove cross-era false connections.
 *
 * A cross-era anomaly: two players who couldn't have played each other because
 * their known game dates are separated by decades (e.g. one active only
 * before 1910, the other only after 1950).
 *
 * Usage:
 *   node scripts/validate-data.js            # report anomalies (dry-run)
 *   node scripts/validate-data.js --fix      # delete anomalous pairs
 *
 * Heuristic:
 *   1. Compute each player's era from their dated opponent pairs.
 *   2. Flag any pair where one player's last known game is before PRE_CUTOFF
 *      and the other's first known game is after POST_CUTOFF.
 *   3. Flag pairs where one player has a FIDE ID (registered post-1970)
 *      and the other's era is entirely before PRE_CUTOFF.
 *   4. Flag all neighbors of known pre-1900 anchor players (Morphy, Anderssen)
 *      who have a FIDE ID OR whose earliest known game is after 1920.
 *      This catches false links introduced via deduplication merges.
 */

const postgres = require("postgres");

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const FIX = process.argv.includes("--fix");

const PRE_CUTOFF  = "1910-01-01"; // player's last game before this → historical
const POST_CUTOFF = "1950-01-01"; // player's first game after this  → modern

async function main() {

  // Find suspicious pairs entirely in SQL — no full table scan in JS
  console.log("\nScanning all opponent pairs for cross-era anomalies (SQL)...");

  const suspicious = await sql`
    WITH player_era AS (
      SELECT player_id,
             MIN(first_game_date) AS first_game,
             MAX(last_game_date)  AS last_game
      FROM (
        SELECT player_a_id AS player_id, first_game_date, last_game_date FROM opponents WHERE first_game_date IS NOT NULL
        UNION ALL
        SELECT player_b_id AS player_id, first_game_date, last_game_date FROM opponents WHERE first_game_date IS NOT NULL
      ) t
      GROUP BY player_id
    )
    SELECT
      o.player_a_id, o.player_b_id,
      o.game_count, o.first_game_date, o.event_sample,
      pa.name AS name_a, pa.fide_id AS fide_a,
      pb.name AS name_b, pb.fide_id AS fide_b,
      ea.first_game AS era_a_first, ea.last_game AS era_a_last,
      eb.first_game AS era_b_first, eb.last_game AS era_b_last
    FROM opponents o
    JOIN players pa ON pa.id = o.player_a_id
    JOIN players pb ON pb.id = o.player_b_id
    LEFT JOIN player_era ea ON ea.player_id = o.player_a_id
    LEFT JOIN player_era eb ON eb.player_id = o.player_b_id
    WHERE
      -- Check 1: dated eras don't overlap
      (ea.last_game < ${PRE_CUTOFF} AND eb.first_game > ${POST_CUTOFF})
      OR (eb.last_game < ${PRE_CUTOFF} AND ea.first_game > ${POST_CUTOFF})
      -- Check 2: FIDE-registered player linked to pre-1910 historical player
      OR (pa.fide_id IS NOT NULL AND eb.last_game < ${PRE_CUTOFF})
      OR (pb.fide_id IS NOT NULL AND ea.last_game < ${PRE_CUTOFF})
    ORDER BY ea.last_game NULLS LAST, eb.last_game NULLS LAST
  `;

  // Check 3 & 4: neighbors of known pre-1900 anchors that shouldn't be connected.
  // Check 3: neighbor has a FIDE ID (registered post-1970) — impossible to have played them.
  // Check 4: neighbor's earliest known game is after ANCHOR_CUTOFF — they are clearly modern.
  // Known pre-1900 player IDs: Morphy=157633, Anderssen=157588
  const PRE1900_ANCHORS = [157633, 157588];
  const ANCHOR_CUTOFF = "1920-01-01"; // any neighbor whose first game is after this is suspicious
  const anchorSuspicious = await sql`
    WITH neighbor_era AS (
      SELECT player_id, MIN(first_game_date) AS first_game
      FROM (
        SELECT player_a_id AS player_id, first_game_date FROM opponents WHERE first_game_date IS NOT NULL
        UNION ALL
        SELECT player_b_id AS player_id, first_game_date FROM opponents WHERE first_game_date IS NOT NULL
      ) t
      GROUP BY player_id
    )
    SELECT
      o.player_a_id, o.player_b_id,
      o.game_count, o.first_game_date, o.event_sample,
      pa.name AS name_a, pa.fide_id AS fide_a,
      pb.name AS name_b, pb.fide_id AS fide_b,
      NULL::timestamptz AS era_a_first, NULL::timestamptz AS era_a_last,
      NULL::timestamptz AS era_b_first, NULL::timestamptz AS era_b_last
    FROM opponents o
    JOIN players pa ON pa.id = o.player_a_id
    JOIN players pb ON pb.id = o.player_b_id
    LEFT JOIN neighbor_era nea ON nea.player_id = o.player_a_id
    LEFT JOIN neighbor_era neb ON neb.player_id = o.player_b_id
    WHERE
      -- Anchor is player_a, neighbor is player_b
      (o.player_a_id = ANY(${PRE1900_ANCHORS}) AND (
        pb.fide_id IS NOT NULL           -- Check 3: neighbor has FIDE ID
        OR neb.first_game > ${ANCHOR_CUTOFF}  -- Check 4: neighbor's era starts after 1920
      ))
      -- Anchor is player_b, neighbor is player_a
      OR (o.player_b_id = ANY(${PRE1900_ANCHORS}) AND (
        pa.fide_id IS NOT NULL           -- Check 3: neighbor has FIDE ID
        OR nea.first_game > ${ANCHOR_CUTOFF}  -- Check 4: neighbor's era starts after 1920
      ))
  `;
  const seen = new Set(suspicious.map(s => `${s.player_a_id}:${s.player_b_id}`));
  for (const s of anchorSuspicious) {
    const key = `${s.player_a_id}:${s.player_b_id}`;
    if (!seen.has(key)) { suspicious.push(s); seen.add(key); }
  }

  if (suspicious.length === 0) {
    console.log("  No cross-era anomalies found.");
    return;
  }

  console.log(`\nFound ${suspicious.length} suspicious pair(s):\n`);
  for (const s of suspicious) {
    const eraA = s.era_a_last ? s.era_a_last.toISOString().slice(0,10) : "?";
    const eraB = s.era_b_first ? s.era_b_first.toISOString().slice(0,10) : "?";
    console.log(`  [${s.player_a_id} ↔ ${s.player_b_id}] ${s.name_a} / ${s.name_b}`);
    console.log(`    Games: ${s.game_count}  Event: ${s.event_sample ?? "(no date)"}`);
    console.log(`    Era A last: ${eraA}  Era B first: ${eraB}`);
  }

  if (!FIX) {
    console.log(`\nRun with --fix to delete these ${suspicious.length} pair(s).`);
    return;
  }

  console.log(`\nDeleting ${suspicious.length} anomalous pair(s)...`);
  for (const s of suspicious) {
    await sql`
      DELETE FROM opponents
      WHERE player_a_id = ${s.player_a_id} AND player_b_id = ${s.player_b_id}
    `;
    console.log(`  Deleted: ${s.name_a} ↔ ${s.name_b}`);
  }
  console.log("Done.");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
