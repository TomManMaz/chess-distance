const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

async function main() {
  const morphyId = 157633;
  const knottId  = 157419; // Knott, Simon JB (born 1958 — cannot have played Morphy 1859)

  // Remove the false link
  const [a, b] = morphyId < knottId ? [morphyId, knottId] : [knottId, morphyId];
  await sql`DELETE FROM opponents WHERE player_a_id = ${a} AND player_b_id = ${b}`;
  console.log("Removed false Morphy–Knott link");

  // Show Morphy's remaining opponents
  const opps = await sql`
    SELECT p.name, o.game_count, o.first_game_date
    FROM opponents o
    JOIN players p ON p.id = CASE WHEN o.player_a_id = ${morphyId} THEN o.player_b_id ELSE o.player_a_id END
    WHERE o.player_a_id = ${morphyId} OR o.player_b_id = ${morphyId}
    ORDER BY o.game_count DESC
  `;
  console.log(`\nMorphy now has ${opps.length} opponents:`);
  opps.forEach(o => console.log(`  ${o.name} (${o.game_count} games)`));

  // Also remove Knott entirely from the players table if they have no other connections
  // (keep them — they're a real modern player with TWIC games)
  console.log("\nKnott stays in the DB as a real modern player.");
}

main().catch(console.error);
