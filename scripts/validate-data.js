// Remove players who appear to be data anomalies:
// players who are linked to BOTH pre-1900 historical players AND modern players
// (which would indicate a name collision across eras)
// For now, just remove orphaned/suspicious cross-era links

const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);

async function main() {
  // Find players whose name appears in both historical contexts (no FIDE ID, linked to Morphy era)
  // AND modern TWIC context - these are likely name collisions

  // Specifically: Morphy (id 157633) played in 1850s-1860s
  // His real opponents should only link to other pre-1900 players
  // Any opponent of Morphy who ALSO has links to post-1995 TWIC players is suspicious

  // Get Morphy's opponents
  const morphyOpp = await sql`
    SELECT CASE WHEN o.player_a_id = 157633 THEN o.player_b_id ELSE o.player_a_id END AS opp_id, o.game_count
    FROM opponents o WHERE o.player_a_id = 157633 OR o.player_b_id = 157633
  `;

  console.log(`Morphy has ${morphyOpp.length} opponents`);

  // For each of Morphy's opponents, check if they have dates in their connections
  // that suggest they're modern players (post-1950)
  let suspicious = [];

  for (const opp of morphyOpp) {
    const latestGame = await sql`
      SELECT MAX(last_game_date) as latest FROM opponents
      WHERE player_a_id = ${opp.opp_id} OR player_b_id = ${opp.opp_id}
    `;
    const latest = latestGame[0].latest;
    if (latest && latest > '1920-01-01') {
      const p = await sql`SELECT name, fide_id FROM players WHERE id = ${opp.opp_id}`;
      suspicious.push({ id: opp.opp_id, name: p[0].name, fide_id: p[0].fide_id, latest, games: opp.game_count });
    }
  }

  console.log(`\nSuspicious cross-era Morphy opponents (${suspicious.length}):`);
  for (const s of suspicious) {
    console.log(`  ${s.name} (id=${s.id}, fide_id=${s.fide_id}, latest_game=${s.latest}, games=${s.games})`);
  }

  // Remove the suspicious links
  if (suspicious.length > 0) {
    for (const s of suspicious) {
      await sql`
        DELETE FROM opponents
        WHERE (player_a_id = 157633 AND player_b_id = ${s.id})
        OR (player_a_id = ${s.id} AND player_b_id = 157633)
      `;
      console.log(`Removed link: Morphy <-> ${s.name}`);
    }
  }

  // Re-check Morphy's connections
  const remaining = await sql`
    SELECT count(*) FROM opponents WHERE player_a_id = 157633 OR player_b_id = 157633
  `;
  console.log(`\nMorphy now has ${remaining[0].count} opponents`);
}

main().catch(console.error);
