const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

async function main() {
  const meId = 239909; // Mannelli Mazzoli, Tommaso
  const bartoliniId = 182903; // Bartolini,Leonardo — wrong match

  // Remove the false Bartolini–Tommaso link
  const [aId, bId] = meId < bartoliniId ? [meId, bartoliniId] : [bartoliniId, meId];
  await sql`DELETE FROM opponents WHERE player_a_id = ${aId} AND player_b_id = ${bId}`;
  console.log("Removed false Bartolini,Leonardo link");

  // Insert correct Bettollini, Leonardo
  const ins = await sql`
    INSERT INTO players (name, federation) VALUES ('Bettollini, Leonardo', 'ITA') RETURNING id
  `;
  const bettolliniId = ins[0].id;
  console.log("Inserted Bettollini, Leonardo (id=" + bettolliniId + ")");

  // Link to Tommaso (blitz)
  const [newA, newB] = meId < bettolliniId ? [meId, bettolliniId] : [bettolliniId, meId];
  await sql`
    INSERT INTO opponents (player_a_id, player_b_id, game_count, classical_count, rapid_count, blitz_count, first_game_date, last_game_date, event_sample)
    VALUES (${newA}, ${newB}, 1, 0, 0, 1, '2025-12-13', '2025-12-13', 'CR TOSCANA BLITZ 2025')
  `;
  console.log("Linked Bettollini, Leonardo to Tommaso (blitz)");

  // Final count
  const conns = await sql`SELECT count(*) FROM opponents WHERE player_a_id = ${meId} OR player_b_id = ${meId}`;
  console.log("Tommaso total connections:", conns[0].count);
}

main().catch(console.error);
