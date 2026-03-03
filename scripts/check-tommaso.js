const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

async function main() {
  const me = await sql`SELECT id, name, fide_id FROM players WHERE fide_id = 2842411`;
  if (!me.length) { console.log("Tommaso not found"); return; }
  const meId = me[0].id;
  console.log("Tommaso:", me[0]);

  const conns = await sql`
    SELECT o.game_count, o.classical_count, p.name
    FROM opponents o
    JOIN players p ON p.id = CASE WHEN o.player_a_id = ${meId} THEN o.player_b_id ELSE o.player_a_id END
    WHERE o.player_a_id = ${meId} OR o.player_b_id = ${meId}
  `;
  console.log("Connections:", conns.length);
  conns.forEach(c => console.log(`  ${c.name}: game_count=${c.game_count} classical_count=${c.classical_count}`));
}

main().catch(console.error);
