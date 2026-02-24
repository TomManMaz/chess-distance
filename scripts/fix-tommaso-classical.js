const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);

async function main() {
  // Set classical_count = game_count for Tommaso's connections (id=239909)
  // These are real OTB classical games from an October 2023 tournament
  await sql`
    UPDATE opponents
    SET classical_count = game_count
    WHERE (player_a_id = 239909 OR player_b_id = 239909)
      AND classical_count = 0
  `;
  console.log("Updated Tommaso classical counts");

  const check = await sql`
    SELECT p.name, o.game_count, o.classical_count
    FROM opponents o
    JOIN players p ON p.id = CASE WHEN o.player_a_id = 239909 THEN o.player_b_id ELSE o.player_a_id END
    WHERE o.player_a_id = 239909 OR o.player_b_id = 239909
  `;
  check.forEach(c => console.log(`  ${c.name}: game=${c.game_count} classical=${c.classical_count}`));
}

main().catch(console.error);
