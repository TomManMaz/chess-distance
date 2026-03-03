const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

const names = [
  "Conti, Guido",
  "Dal Pra Caputo, Stefano",
  "Iannone, Alessandro",
];

async function main() {
  for (const name of names) {
    const parts = name.toLowerCase().split(/[\s,]+/).filter(Boolean);
    // Try various fuzzy searches
    const results = await sql`
      SELECT id, name, fide_id, federation, title,
             similarity(name, ${name}) AS sim
      FROM players
      WHERE name % ${name}
         OR name ILIKE ${'%' + parts[0] + '%'}
      ORDER BY sim DESC
      LIMIT 5
    `;
    console.log(`\n"${name}":`);
    if (results.length === 0) {
      console.log("  NOT FOUND");
    } else {
      results.forEach(r =>
        console.log(`  [${r.id}] "${r.name}" fide=${r.fide_id} fed=${r.federation} title=${r.title} sim=${Number(r.sim).toFixed(2)}`)
      );
    }
  }
}

main().catch(console.error);
