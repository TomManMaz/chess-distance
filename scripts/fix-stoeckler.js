const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);

async function main() {
  const meId = 239909; // Mannelli Mazzoli, Tommaso
  const steindlId = 160418; // Wrong match

  // Remove the false Steindl link
  const [aId, bId] = meId < steindlId ? [meId, steindlId] : [steindlId, meId];
  await sql`DELETE FROM opponents WHERE player_a_id = ${aId} AND player_b_id = ${bId}`;
  console.log("Removed false link to Steindl,Johannes");

  // Insert actual Stoeckler, Johannes
  const ins = await sql`INSERT INTO players (name, federation) VALUES ('Stoeckler, Johannes', 'AUT') RETURNING id`;
  const stoecklerId = ins[0].id;
  console.log(`Inserted Stoeckler, Johannes (id=${stoecklerId})`);

  // Link to Tommaso
  const [a, b] = meId < stoecklerId ? [meId, stoecklerId] : [stoecklerId, meId];
  await sql`
    INSERT INTO opponents (player_a_id, player_b_id, game_count, first_game_date, last_game_date)
    VALUES (${a}, ${b}, 1, '2023-10-01', '2023-10-01')
    ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET game_count = opponents.game_count + 1
  `;
  console.log("Linked Stoeckler, Johannes to Mannelli Mazzoli");

  // Verify all Tommaso's links
  const links = await sql`
    SELECT p.name, p.federation FROM opponents o
    JOIN players p ON p.id = CASE WHEN o.player_a_id = ${meId} THEN o.player_b_id ELSE o.player_a_id END
    WHERE o.player_a_id = ${meId} OR o.player_b_id = ${meId}
  `;
  console.log("\nYour opponents in DB:");
  links.forEach(l => console.log(`  ${l.name} (${l.federation})`));
}

main().catch(console.error);
