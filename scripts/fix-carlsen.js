/**
 * Fix the Carlsen mess:
 *  1. Delete corrupt "Carlsen,6" (only 1 connection, clearly wrong)
 *  2. Merge "Carlsen,Magnus" (PGN Mentor, no FIDE ID, 9 connections)
 *     into "Carlsen,M" (FIDE XML, fide_id=1503014, 1286 connections)
 *  3. Rename "Carlsen,M" → "Carlsen, Magnus" for display
 */
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

async function main() {
  const CORRUPT  = 156349; // "Carlsen,6"
  const OLD      = 164503; // "Carlsen,Magnus" – PGN Mentor, no FIDE ID
  const CANONICAL = 185650; // "Carlsen,M" – FIDE XML, fide_id=1503014

  // ── 1. Delete the corrupt entry ──────────────────────────────────────────
  await sql`DELETE FROM opponents WHERE player_a_id = ${CORRUPT} OR player_b_id = ${CORRUPT}`;
  await sql`DELETE FROM players   WHERE id = ${CORRUPT}`;
  console.log('Deleted "Carlsen,6"');

  // ── 2. Merge OLD → CANONICAL ─────────────────────────────────────────────
  // Transfer opponent links from OLD that don't already exist under CANONICAL
  const oldLinks = await sql`
    SELECT CASE WHEN player_a_id = ${OLD} THEN player_b_id ELSE player_a_id END AS other_id,
           game_count, first_game_date, last_game_date
    FROM opponents
    WHERE player_a_id = ${OLD} OR player_b_id = ${OLD}
  `;
  console.log(`Merging ${oldLinks.length} connections from "Carlsen,Magnus" → "Carlsen,M"...`);

  for (const link of oldLinks) {
    if (link.other_id === CANONICAL) continue;
    const [a, b] = CANONICAL < link.other_id ? [CANONICAL, link.other_id] : [link.other_id, CANONICAL];
    await sql`
      INSERT INTO opponents (player_a_id, player_b_id, game_count, first_game_date, last_game_date)
      VALUES (${a}, ${b}, ${link.game_count}, ${link.first_game_date}, ${link.last_game_date})
      ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET
        game_count      = opponents.game_count + EXCLUDED.game_count,
        first_game_date = LEAST(opponents.first_game_date, EXCLUDED.first_game_date),
        last_game_date  = GREATEST(opponents.last_game_date, EXCLUDED.last_game_date)
    `;
  }
  await sql`DELETE FROM opponents WHERE player_a_id = ${OLD} OR player_b_id = ${OLD}`;
  await sql`DELETE FROM players   WHERE id = ${OLD}`;
  console.log('Merged and deleted old "Carlsen,Magnus"');

  // ── 3. Rename canonical to proper display name ───────────────────────────
  await sql`UPDATE players SET name = 'Carlsen, Magnus', federation = 'NOR' WHERE id = ${CANONICAL}`;
  console.log('Renamed to "Carlsen, Magnus"');

  // ── 4. Verify ─────────────────────────────────────────────────────────────
  const result = await sql`SELECT id, name, fide_id, federation FROM players WHERE id = ${CANONICAL}`;
  const conns  = await sql`SELECT count(*) FROM opponents WHERE player_a_id = ${CANONICAL} OR player_b_id = ${CANONICAL}`;
  console.log('\nFinal state:', result[0], '— connections:', conns[0].count);
}

main().catch(console.error);
