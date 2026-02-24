const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);
async function main() {
  // Check Bartolini vs Bettollini
  const b = await sql`SELECT id, name, fide_id, federation FROM players WHERE id = 182903`;
  console.log("Bartolini (id=182903):", b[0]);

  const b2 = await sql`SELECT id, name, fide_id, federation FROM players WHERE name ILIKE '%bettollini%'`;
  console.log("Bettollini search:", b2);

  // Check Conti Guido
  const c = await sql`SELECT id, name, fide_id, federation FROM players WHERE id = 239911`;
  console.log("Conti Guido (id=239911):", c[0]);

  const c2 = await sql`SELECT id, name, fide_id FROM players WHERE fide_id = 2814868`;
  console.log("Conti FIDE 2814868:", c2);
}
main().catch(console.error);
