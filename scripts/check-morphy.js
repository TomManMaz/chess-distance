const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

async function main() {
  const morphyId = 157633;

  // Get all Morphy's opponents
  const opponents = await sql`
    SELECT p.id, p.name, p.fide_id, o.game_count, o.first_game_date, o.last_game_date
    FROM opponents o
    JOIN players p ON p.id = CASE WHEN o.player_a_id = ${morphyId} THEN o.player_b_id ELSE o.player_a_id END
    WHERE o.player_a_id = ${morphyId} OR o.player_b_id = ${morphyId}
    ORDER BY o.game_count DESC
    LIMIT 20
  `;

  console.log(`Morphy's top opponents (${opponents.length} shown):`);
  for (const o of opponents) {
    console.log(`  ${o.name} (${o.game_count} games, ${o.first_game_date} - ${o.last_game_date})`);
  }

  // Check Knott
  const knott = await sql`SELECT id, name FROM players WHERE name ILIKE '%knott%'`;
  console.log("\nKnott:", knott);
}

main().catch(console.error);
