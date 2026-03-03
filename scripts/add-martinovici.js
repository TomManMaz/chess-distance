const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

async function main() {
  // Find Tommaso
  const me = await sql`SELECT id, name FROM players WHERE fide_id = 2842411`;
  if (!me.length) { console.log("Tommaso not found"); return; }
  const meId = me[0].id;
  console.log("Found:", me[0].name, "(id=" + meId + ")");

  // Find Martinovici
  const martinovici = await sql`
    SELECT id, name, fide_id, title, federation,
           similarity(name, 'Martinovici') AS sim
    FROM players
    WHERE name % 'Martinovici'
    ORDER BY sim DESC
    LIMIT 5
  `;
  console.log("\nMartinovic search results:");
  martinovici.forEach(p => console.log(`  [${p.id}] "${p.name}" fide_id=${p.fide_id} title=${p.title} fed=${p.federation} sim=${Number(p.sim).toFixed(3)}`));

  if (!martinovici.length) { console.log("Not found!"); return; }
  const opp = martinovici[0];
  const oppId = opp.id;

  // Create blitz opponent pair
  const [aId, bId] = meId < oppId ? [meId, oppId] : [oppId, meId];
  await sql`
    INSERT INTO opponents (player_a_id, player_b_id, game_count, classical_count, rapid_count, blitz_count, first_game_date, last_game_date)
    VALUES (${aId}, ${bId}, 1, 0, 0, 1, '2025-01-01', '2025-01-01')
    ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET
      game_count  = opponents.game_count + 1,
      blitz_count = opponents.blitz_count + 1,
      last_game_date = GREATEST(opponents.last_game_date, '2025-01-01')
  `;
  console.log(`\nLinked: ${me[0].name} ↔ ${opp.name} (blitz, 1 game)`);

  // Verify
  const link = await sql`
    SELECT game_count, classical_count, blitz_count FROM opponents
    WHERE player_a_id = ${aId} AND player_b_id = ${bId}
  `;
  console.log("Link:", link[0]);
}

main().catch(console.error);
