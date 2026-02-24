/**
 * Add opponents from CR TOSCANA BLITZ 2025
 * Empoli, Italy — December 13, 2025
 * Source: FIDE blitz calculations for Mannelli Mazzoli, Tommaso (2842411)
 *   https://ratings.fide.com/a_indv_calculations.php?id_number=2842411&rating_period=2026-01-01&t=2
 */
const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);

const EVENT_DATE = "2025-12-13";

// Opponents from the FIDE blitz calculations page (rating shown for reference)
const OPPONENTS = [
  { name: "Martinovici, Ilie", federation: "MDA", rating: 2166 },
  { name: "Pin, Orlando",      federation: "ITA", rating: 1752 },
  { name: "Roccanti, Lapo",    federation: "ITA", rating: 1933 },
  { name: "Gabbani, Sara",     federation: "ITA", rating: 1892 },
  { name: "Bettollini, Leonardo", federation: "ITA", rating: 1654 },
  { name: "De Filomeno, Simone",  federation: "ITA", rating: 2166 },
  { name: "Ceccarini, Marco",  federation: "ITA", rating: 1953 },
  { name: "Caprino, Marco",    federation: "ITA", rating: 2100 },
  { name: "Ranasinghe Arachchig, Malinda", federation: "ITA", rating: 1811 },
  { name: "Conti, Guido",      federation: "ITA", rating: 1909 },
  { name: "Montorsi, Matteo",  federation: "ITA", rating: 2132 },
];

async function findPlayer(name, federation) {
  // Exact match
  const exact = await sql`
    SELECT id, name, fide_id FROM players
    WHERE lower(trim(name)) = lower(trim(${name}))
  `;
  if (exact.length > 0) return { player: exact[0], matched: "exact" };

  // Fuzzy
  const fuzzy = await sql`
    SELECT id, name, fide_id, similarity(name, ${name}) AS sim
    FROM players WHERE name % ${name}
    ORDER BY sim DESC LIMIT 5
  `;
  if (fuzzy.length > 0) return { player: fuzzy[0], matched: "fuzzy", all: fuzzy };
  return null;
}

async function main() {
  const me = await sql`SELECT id, name FROM players WHERE fide_id = 2842411`;
  if (!me.length) { console.log("Tommaso not found"); return; }
  const meId = me[0].id;
  console.log("Me:", me[0].name, "(id=" + meId + ")");
  console.log("Event: CR TOSCANA BLITZ 2025 —", EVENT_DATE, "\n");

  for (const opp of OPPONENTS) {
    process.stdout.write(`Looking up: ${opp.name} (${opp.federation})... `);
    const found = await findPlayer(opp.name, opp.federation);

    let oppId;
    if (found && found.matched === "exact") {
      oppId = found.player.id;
      console.log(`found exact: "${found.player.name}" (id=${oppId})`);
    } else if (found && found.matched === "fuzzy") {
      const sim = found.player.sim;
      if (sim >= 0.5) {
        oppId = found.player.id;
        console.log(`fuzzy match (sim=${Number(sim).toFixed(2)}): "${found.player.name}" (id=${oppId})`);
      } else {
        // Insert new player
        const ins = await sql`
          INSERT INTO players (name, federation) VALUES (${opp.name}, ${opp.federation}) RETURNING id
        `;
        oppId = ins[0].id;
        console.log(`inserted new: "${opp.name}" (id=${oppId})`);
      }
    } else {
      const ins = await sql`
        INSERT INTO players (name, federation) VALUES (${opp.name}, ${opp.federation}) RETURNING id
      `;
      oppId = ins[0].id;
      console.log(`inserted new: "${opp.name}" (id=${oppId})`);
    }

    // Link as blitz opponent
    const [aId, bId] = meId < oppId ? [meId, oppId] : [oppId, meId];
    await sql`
      INSERT INTO opponents (player_a_id, player_b_id, game_count, classical_count, rapid_count, blitz_count, first_game_date, last_game_date, event_sample)
      VALUES (${aId}, ${bId}, 1, 0, 0, 1, ${EVENT_DATE}, ${EVENT_DATE}, 'CR TOSCANA BLITZ 2025')
      ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET
        game_count  = opponents.game_count + 1,
        blitz_count = opponents.blitz_count + 1,
        last_game_date = GREATEST(opponents.last_game_date, ${EVENT_DATE}),
        event_sample = COALESCE(opponents.event_sample, 'CR TOSCANA BLITZ 2025')
    `;
    console.log("  → linked (blitz)\n");
  }

  // Summary
  const conns = await sql`
    SELECT p.name, o.game_count, o.classical_count, o.blitz_count
    FROM opponents o
    JOIN players p ON p.id = CASE WHEN o.player_a_id = ${meId} THEN o.player_b_id ELSE o.player_a_id END
    WHERE o.player_a_id = ${meId} OR o.player_b_id = ${meId}
    ORDER BY o.last_game_date DESC
  `;
  console.log(`\n=== Tommaso now has ${conns.length} opponents ===`);
  conns.forEach(c => console.log(`  ${c.name}: ${c.game_count} game(s) [classical=${c.classical_count} blitz=${c.blitz_count}]`));
}

main().catch(console.error);
