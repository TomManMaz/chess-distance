const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

async function main() {
  // Find and remove dummy/placeholder players that create false connections
  const dummies = await sql`
    SELECT id, name FROM players
    WHERE name IN ('NN', 'N.N.', 'N.N', '?', '??', 'Unknown', 'unknown', 'Comp', 'Computer')
    OR name LIKE 'Comp %'
    OR name LIKE 'Team %'
  `;

  console.log(`Found ${dummies.length} dummy players to remove:`);
  for (const d of dummies) {
    console.log(`  ${d.id}: "${d.name}"`);
  }

  if (dummies.length > 0) {
    const ids = dummies.map(d => d.id);
    // Delete opponent pairs involving dummy players
    for (const id of ids) {
      const del = await sql`DELETE FROM opponents WHERE player_a_id = ${id} OR player_b_id = ${id}`;
      console.log(`  Deleted pairs for player ${id}`);
    }
    // Delete dummy players
    for (const id of ids) {
      await sql`DELETE FROM players WHERE id = ${id}`;
    }
    console.log(`Removed ${ids.length} dummy players and their connections`);
  }

  // Check remaining stats
  const stats = await sql`SELECT (SELECT count(*) FROM players) as p, (SELECT count(*) FROM opponents) as o`;
  console.log(`\nRemaining: ${stats[0].p} players, ${stats[0].o} opponent pairs`);
}

main().catch(console.error);
