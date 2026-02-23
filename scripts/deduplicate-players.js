/**
 * deduplicate-players.js
 *
 * One-time cleanup script to merge duplicate player rows:
 *  Phase 1: Exact duplicates (same LOWER(TRIM(name)))
 *  Phase 2: Abbreviated-name duplicates ("Kasparov, G" → "Kasparov, Garry")
 *
 * Usage:
 *   DATABASE_URL=... node scripts/deduplicate-players.js
 *   DATABASE_URL=... node scripts/deduplicate-players.js --dry-run
 */

const { neon } = require("@neondatabase/serverless");

const DB_URL = process.env.DATABASE_URL;
const DRY_RUN = process.argv.includes("--dry-run");

if (!DB_URL) { console.error("No DATABASE_URL"); process.exit(1); }
const sql = neon(DB_URL);

// ---------------------------------------------------------------------------
// Helper: merge dropId into keepId
//   - Updates opponents rows (re-pointing dropId → keepId, merging on conflict)
//   - Inherits title/federation from dropped row if canonical is missing them
//   - Deletes the dropped player row
// ---------------------------------------------------------------------------
async function mergeInto(keepId, dropId, dryRun) {
  if (dryRun) return;

  // Inherit title / federation if the canonical is missing them
  await sql`
    UPDATE players
    SET
      title      = COALESCE(players.title,      (SELECT title      FROM players WHERE id = ${dropId})),
      federation = COALESCE(players.federation, (SELECT federation FROM players WHERE id = ${dropId}))
    WHERE id = ${keepId}
  `;

  // Get all opponent rows involving dropId
  const rows = await sql`
    SELECT player_a_id, player_b_id, game_count, first_game_date, last_game_date,
           classical_count, rapid_count, blitz_count, event_sample
    FROM opponents
    WHERE player_a_id = ${dropId} OR player_b_id = ${dropId}
  `;

  for (const row of rows) {
    // Compute the other player in this pair
    const otherId = row.player_a_id === dropId ? row.player_b_id : row.player_a_id;

    // Skip self-loops that would arise if otherId === keepId (already the same player)
    if (otherId === keepId) {
      await sql`DELETE FROM opponents WHERE player_a_id = ${row.player_a_id} AND player_b_id = ${row.player_b_id}`;
      continue;
    }

    // Build the canonical pair key with player_a_id < player_b_id
    const [newA, newB] = keepId < otherId ? [keepId, otherId] : [otherId, keepId];

    // Check if a pair (keepId, otherId) already exists
    const existing = await sql`
      SELECT game_count, first_game_date, last_game_date
      FROM opponents
      WHERE player_a_id = ${newA} AND player_b_id = ${newB}
    `;

    if (existing.length > 0) {
      // Merge into existing row
      await sql`
        UPDATE opponents
        SET
          game_count      = game_count + ${row.game_count},
          first_game_date = LEAST(first_game_date, ${row.first_game_date}),
          last_game_date  = GREATEST(last_game_date, ${row.last_game_date}),
          classical_count = classical_count + ${row.classical_count ?? 0},
          rapid_count     = rapid_count + ${row.rapid_count ?? 0},
          blitz_count     = blitz_count + ${row.blitz_count ?? 0},
          event_sample    = COALESCE(event_sample, ${row.event_sample ?? null})
        WHERE player_a_id = ${newA} AND player_b_id = ${newB}
      `;
      // Delete the stale row
      await sql`DELETE FROM opponents WHERE player_a_id = ${row.player_a_id} AND player_b_id = ${row.player_b_id}`;
    } else {
      // Re-point the existing row to use keepId
      await sql`DELETE FROM opponents WHERE player_a_id = ${row.player_a_id} AND player_b_id = ${row.player_b_id}`;
      await sql`
        INSERT INTO opponents (player_a_id, player_b_id, game_count, first_game_date, last_game_date, classical_count, rapid_count, blitz_count, event_sample)
        VALUES (${newA}, ${newB}, ${row.game_count}, ${row.first_game_date}, ${row.last_game_date}, ${row.classical_count ?? 0}, ${row.rapid_count ?? 0}, ${row.blitz_count ?? 0}, ${row.event_sample ?? null})
        ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET
          game_count      = opponents.game_count + EXCLUDED.game_count,
          first_game_date = LEAST(opponents.first_game_date, EXCLUDED.first_game_date),
          last_game_date  = GREATEST(opponents.last_game_date, EXCLUDED.last_game_date),
          classical_count = opponents.classical_count + EXCLUDED.classical_count,
          rapid_count     = opponents.rapid_count + EXCLUDED.rapid_count,
          blitz_count     = opponents.blitz_count + EXCLUDED.blitz_count,
          event_sample    = COALESCE(opponents.event_sample, EXCLUDED.event_sample)
      `;
    }
  }

  // Delete the dropped player
  await sql`DELETE FROM players WHERE id = ${dropId}`;
}

// ---------------------------------------------------------------------------
// Choose the canonical player from a group (which one survives the merge)
// Prefer: has FIDE ID → longer name → most games played
// ---------------------------------------------------------------------------
function pickCanonical(players) {
  return players.reduce((best, cur) => {
    if (cur.fide_id && !best.fide_id) return cur;
    if (!cur.fide_id && best.fide_id) return best;
    if (cur.total_games > best.total_games) return cur;
    if (cur.name.length > best.name.length) return cur;
    return best;
  });
}

// ---------------------------------------------------------------------------
// Phase 1: Exact duplicates (same LOWER(TRIM(name)))
// ---------------------------------------------------------------------------
async function phase1ExactDuplicates(dryRun) {
  console.log("\n=== Phase 1: Exact duplicates ===");

  const groups = await sql`
    SELECT
      LOWER(TRIM(p.name)) AS norm,
      array_agg(
        json_build_object(
          'id', p.id,
          'name', p.name,
          'fide_id', p.fide_id,
          'title', p.title,
          'federation', p.federation,
          'total_games', COALESCE(gc.total_games, 0)
        )
        ORDER BY COALESCE(gc.total_games, 0) DESC
      ) AS players
    FROM players p
    LEFT JOIN (
      SELECT id,
        COALESCE(
          (SELECT SUM(game_count) FROM opponents
           WHERE player_a_id = players.id OR player_b_id = players.id),
          0
        ) AS total_games
      FROM players
    ) gc ON gc.id = p.id
    GROUP BY LOWER(TRIM(p.name))
    HAVING COUNT(*) > 1
    ORDER BY LOWER(TRIM(p.name))
  `;

  console.log(`  Found ${groups.length} exact-duplicate groups`);

  let merged = 0;
  for (const group of groups) {
    const players = group.players.map(p => typeof p === "string" ? JSON.parse(p) : p);
    const canonical = pickCanonical(players);
    const duplicates = players.filter(p => p.id !== canonical.id);

    for (const dup of duplicates) {
      if (dryRun) {
        console.log(`  [DRY-RUN] Merge "${dup.name}" (id=${dup.id}) → "${canonical.name}" (id=${canonical.id})`);
      } else {
        process.stdout.write(`  Merging "${dup.name}" → "${canonical.name}" ...`);
        await mergeInto(canonical.id, dup.id, false);
        process.stdout.write(" done\n");
      }
      merged++;
    }
  }

  console.log(`  Merged ${merged} exact duplicates`);
  return merged;
}

// ---------------------------------------------------------------------------
// Phase 2: Abbreviated-name duplicates ("Lastname, G" → "Lastname, Garry")
// ---------------------------------------------------------------------------
async function phase2AbbreviatedNames(dryRun) {
  console.log("\n=== Phase 2: Abbreviated-name duplicates ===");

  // Fetch all players from DB
  const allPlayers = await sql`
    SELECT
      p.id, p.name, p.fide_id, p.title, p.federation,
      COALESCE(
        (SELECT SUM(game_count) FROM opponents
         WHERE player_a_id = p.id OR player_b_id = p.id),
        0
      ) AS total_games
    FROM players p
    ORDER BY p.name
  `;

  console.log(`  Loaded ${allPlayers.length} players from DB`);

  // Group by last name (text before the first comma)
  const byLastName = new Map();
  for (const p of allPlayers) {
    const commaIdx = p.name.indexOf(",");
    if (commaIdx === -1) continue; // No comma — skip (can't parse "Lastname, First")
    const lastName = p.name.substring(0, commaIdx).trim().toLowerCase();
    if (!byLastName.has(lastName)) byLastName.set(lastName, []);
    byLastName.get(lastName).push(p);
  }

  // Regex: first name part is a single letter optionally followed by a period (and nothing else)
  const ABBREV_RE = /^,\s*([A-Za-z])\.?\s*$/;

  let merged = 0;
  let ambiguous = 0;

  for (const [lastName, players] of byLastName) {
    if (players.length < 2) continue;

    // Partition into abbreviated and full-name entries
    const abbreviated = [];
    const fullName = [];

    for (const p of players) {
      const afterComma = p.name.substring(p.name.indexOf(","));
      if (ABBREV_RE.test(afterComma)) {
        const letter = afterComma.match(ABBREV_RE)[1].toUpperCase();
        abbreviated.push({ ...p, initial: letter });
      } else {
        fullName.push(p);
      }
    }

    if (abbreviated.length === 0) continue;

    for (const abbrevPlayer of abbreviated) {
      // Find all full-name players whose first name starts with the same initial
      const matches = fullName.filter(fp => {
        const afterComma = fp.name.substring(fp.name.indexOf(",") + 1).trim();
        return afterComma.toUpperCase().startsWith(abbrevPlayer.initial);
      });

      if (matches.length === 0) continue;

      if (matches.length > 1) {
        // Ambiguous — skip
        ambiguous++;
        if (dryRun) {
          console.log(`  [AMBIGUOUS] "${abbrevPlayer.name}" matches ${matches.map(m => `"${m.name}"`).join(", ")}`);
        }
        continue;
      }

      const canonical = matches[0];

      // Decide which is the "real" canonical (might prefer the full-name one)
      // Unless abbreviated player has a FIDE ID and the full-name one doesn't
      let keepId, dropId, keepName, dropName;
      if (abbrevPlayer.fide_id && !canonical.fide_id) {
        keepId = abbrevPlayer.id;
        keepName = abbrevPlayer.name;
        dropId = canonical.id;
        dropName = canonical.name;
      } else {
        keepId = canonical.id;
        keepName = canonical.name;
        dropId = abbrevPlayer.id;
        dropName = abbrevPlayer.name;
      }

      if (dryRun) {
        console.log(`  [DRY-RUN] Merge "${dropName}" (id=${dropId}) → "${keepName}" (id=${keepId})`);
      } else {
        process.stdout.write(`  Merging "${dropName}" → "${keepName}" ...`);
        await mergeInto(keepId, dropId, false);
        process.stdout.write(" done\n");
      }
      merged++;

      // Remove the dropped player from the fullName list for subsequent iterations
      const dropIdx = fullName.findIndex(fp => fp.id === dropId);
      if (dropIdx !== -1) fullName.splice(dropIdx, 1);
      const abbrevIdx = abbreviated.findIndex(ap => ap.id === dropId);
      if (abbrevIdx !== -1) abbreviated.splice(abbrevIdx, 1);
    }
  }

  console.log(`  Merged ${merged} abbreviated duplicates`);
  console.log(`  Skipped ${ambiguous} ambiguous cases`);
  return merged;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (DRY_RUN) {
    console.log("*** DRY-RUN MODE — no changes will be made ***");
  }

  const before = await sql`SELECT (SELECT count(*) FROM players) AS p, (SELECT count(*) FROM opponents) AS o`;
  console.log(`Before: ${before[0].p} players, ${before[0].o} opponent pairs`);

  const exactMerged = await phase1ExactDuplicates(DRY_RUN);
  const abbrevMerged = await phase2AbbreviatedNames(DRY_RUN);

  const after = await sql`SELECT (SELECT count(*) FROM players) AS p, (SELECT count(*) FROM opponents) AS o`;
  console.log(`\n=== Summary ===`);
  console.log(`  Exact duplicates merged:      ${exactMerged}`);
  console.log(`  Abbreviated duplicates merged: ${abbrevMerged}`);
  console.log(`  Total merges:                 ${exactMerged + abbrevMerged}`);

  if (!DRY_RUN) {
    console.log(`\nBefore: ${before[0].p} players, ${before[0].o} opponent pairs`);
    console.log(`After:  ${after[0].p} players, ${after[0].o} opponent pairs`);
  }
}

main().catch(console.error);
