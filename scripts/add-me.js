const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

const ME = { name: "Mannelli Mazzoli, Tommaso", fide_id: 2842411, federation: "ITA" };

// Opponents from FIDE rating calculations October 2023
const OPPONENTS = [
  { name: "Mandukhai, Myagmarsuren", federation: "MGL", result: 0 },
  { name: "Bendl, Felix",            federation: "AUT", result: 0 },
  { name: "Walinga, Eric Jan",       federation: "NED", result: 0 },
  { name: "Stoeckler, Johannes",     federation: "AUT", result: 0 },
  { name: "Anastasakis, Georgios",   federation: "AUT", result: 0 },
  { name: "Kroezen, Roland",         federation: "NED", result: 1 },
  { name: "Fischl, Stefan",          federation: "AUT", result: 0 },
];

async function findPlayer(name) {
  // Try exact match first
  const exact = await sql`SELECT id, name, fide_id FROM players WHERE lower(trim(name)) = lower(trim(${name}))`;
  if (exact.length > 0) return exact[0];

  // Try similarity
  const fuzzy = await sql`SELECT id, name, fide_id, similarity(name, ${name}) AS sim FROM players WHERE name % ${name} ORDER BY sim DESC LIMIT 3`;
  return fuzzy.length > 0 ? fuzzy : null;
}

async function main() {
  // 1. Add or find Tommaso
  let meId;
  const existing = await sql`SELECT id FROM players WHERE fide_id = ${ME.fide_id}`;
  if (existing.length > 0) {
    meId = existing[0].id;
    console.log(`Found existing: ${ME.name} (id=${meId})`);
  } else {
    const inserted = await sql`
      INSERT INTO players (name, fide_id, federation)
      VALUES (${ME.name}, ${ME.fide_id}, ${ME.federation})
      RETURNING id
    `;
    meId = inserted[0].id;
    console.log(`Inserted: ${ME.name} (id=${meId})`);
  }

  // 2. Find/add each opponent and create link
  for (const opp of OPPONENTS) {
    console.log(`\nLooking up: ${opp.name}...`);
    const found = await findPlayer(opp.name);

    let oppId;
    if (found && !Array.isArray(found)) {
      oppId = found.id;
      console.log(`  Found: "${found.name}" (id=${oppId})`);
    } else if (Array.isArray(found) && found.length > 0) {
      console.log(`  Fuzzy matches:`);
      found.forEach(f => console.log(`    [${f.id}] "${f.name}" (sim=${f.sim.toFixed(2)})`));
      // Use best match if similarity > 0.4
      if (found[0].sim > 0.4) {
        oppId = found[0].id;
        console.log(`  Using best match: "${found[0].name}"`);
      } else {
        // Insert new player
        const ins = await sql`INSERT INTO players (name, federation) VALUES (${opp.name}, ${opp.federation}) RETURNING id`;
        oppId = ins[0].id;
        console.log(`  Inserted new: "${opp.name}" (id=${oppId})`);
      }
    } else {
      // Insert new player
      const ins = await sql`INSERT INTO players (name, federation) VALUES (${opp.name}, ${opp.federation}) RETURNING id`;
      oppId = ins[0].id;
      console.log(`  Inserted new: "${opp.name}" (id=${oppId})`);
    }

    // Create opponent pair (a < b)
    const [aId, bId] = meId < oppId ? [meId, oppId] : [oppId, meId];
    await sql`
      INSERT INTO opponents (player_a_id, player_b_id, game_count, classical_count, first_game_date, last_game_date)
      VALUES (${aId}, ${bId}, 1, 1, '2023-10-01', '2023-10-01')
      ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET
        game_count = opponents.game_count + 1,
        classical_count = opponents.classical_count + 1,
        last_game_date = GREATEST(opponents.last_game_date, '2023-10-01')
    `;
    console.log(`  Linked to Mannelli Mazzoli`);
  }

  console.log("\n=== Done! ===");

  // 3. Now compute and show Morphy number
  console.log("\nComputing Morphy number...");
  console.log("(Load the BFS in-memory graph to check)");
  const myLinks = await sql`
    SELECT p.name FROM opponents o
    JOIN players p ON p.id = CASE WHEN o.player_a_id = ${meId} THEN o.player_b_id ELSE o.player_a_id END
    WHERE o.player_a_id = ${meId} OR o.player_b_id = ${meId}
  `;
  console.log("Your opponents in DB:");
  myLinks.forEach(l => console.log(`  ${l.name}`));
}

main().catch(console.error);
