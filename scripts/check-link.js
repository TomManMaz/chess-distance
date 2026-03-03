const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

async function main() {
  // Check direct link between Morphy (157633) and Knott (157419)
  const link = await sql`
    SELECT * FROM opponents
    WHERE (player_a_id = 157633 AND player_b_id = 157419)
    OR (player_a_id = 157419 AND player_b_id = 157633)
  `;
  console.log("Morphy-Knott link:", link);

  // Check what Knott's opponents are
  const knottOpps = await sql`
    SELECT p.name, o.game_count FROM opponents o
    JOIN players p ON p.id = CASE WHEN o.player_a_id = 157419 THEN o.player_b_id ELSE o.player_a_id END
    WHERE o.player_a_id = 157419 OR o.player_b_id = 157419
    ORDER BY o.game_count DESC LIMIT 10
  `;
  console.log("Knott's opponents:", knottOpps);

  // Total Morphy connections
  const total = await sql`
    SELECT count(*) FROM opponents
    WHERE player_a_id = 157633 OR player_b_id = 157633
  `;
  console.log("Total Morphy connections:", total[0].count);
}

main().catch(console.error);
