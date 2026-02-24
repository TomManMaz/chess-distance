const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);

async function main() {
  const total = await sql`SELECT count(*) FROM opponents`;
  const withClassical = await sql`SELECT count(*) FROM opponents WHERE classical_count > 0`;
  const nullClassical = await sql`SELECT count(*) FROM opponents WHERE classical_count IS NULL`;
  const zeroClassical = await sql`SELECT count(*) FROM opponents WHERE classical_count = 0`;
  console.log("Total pairs:          ", total[0].count);
  console.log("classical_count > 0:  ", withClassical[0].count);
  console.log("classical_count IS NULL:", nullClassical[0].count);
  console.log("classical_count = 0:  ", zeroClassical[0].count);

  // Sample
  const sample = await sql`SELECT game_count, classical_count, rapid_count, blitz_count FROM opponents LIMIT 10`;
  console.log("\nSample edges:");
  sample.forEach(r => console.log(`  game=${r.game_count} classical=${r.classical_count} rapid=${r.rapid_count} blitz=${r.blitz_count}`));

  // Check Carlsen (185650) classical edges
  const carlsenTotal = await sql`SELECT count(*) FROM opponents WHERE player_a_id = 185650 OR player_b_id = 185650`;
  const carlsenClassical = await sql`SELECT count(*) FROM opponents WHERE (player_a_id = 185650 OR player_b_id = 185650) AND classical_count > 0`;
  console.log("\nCarlsen total edges:    ", carlsenTotal[0].count);
  console.log("Carlsen classical edges:", carlsenClassical[0].count);

  // Check Morphy (157633) classical edges
  const morphyTotal = await sql`SELECT count(*) FROM opponents WHERE player_a_id = 157633 OR player_b_id = 157633`;
  const morphyClassical = await sql`SELECT count(*) FROM opponents WHERE (player_a_id = 157633 OR player_b_id = 157633) AND classical_count > 0`;
  console.log("\nMorphy total edges:    ", morphyTotal[0].count);
  console.log("Morphy classical edges:", morphyClassical[0].count);
}

main().catch(console.error);
