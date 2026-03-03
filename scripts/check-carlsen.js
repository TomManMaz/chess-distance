const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
async function main() {
  // Simulate the search query
  const q = "Carlsen";
  const results = await sql`
    SELECT id, name, fide_id, federation, title,
           similarity(name, ${q}) AS sim
    FROM players
    WHERE name % ${q}
    ORDER BY sim DESC
    LIMIT 10
  `;
  console.log("Search results for 'Carlsen':");
  results.forEach(r => console.log(`  sim=${Number(r.sim).toFixed(3)} [${r.id}] "${r.name}" fide_id=${r.fide_id}`));

  // Check connections of the corrupt entry
  const corrupt = await sql`
    SELECT count(*) FROM opponents WHERE player_a_id = 156349 OR player_b_id = 156349
  `;
  console.log(`\n"Carlsen,6" (id=156349) has ${corrupt[0].count} opponent connections`);

  // Check connections of real Carlsen
  const real = await sql`
    SELECT count(*) FROM opponents WHERE player_a_id = 164503 OR player_b_id = 164503
  `;
  console.log(`"Carlsen,Magnus" (id=164503) has ${real[0].count} opponent connections`);

  const fide = await sql`
    SELECT count(*) FROM opponents WHERE player_a_id = 185650 OR player_b_id = 185650
  `;
  console.log(`"Carlsen,M" fide=1503014 (id=185650) has ${fide[0].count} opponent connections`);
}
main().catch(console.error);
