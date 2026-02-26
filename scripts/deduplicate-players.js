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

  // Inherit title / federation
  await sql`
    UPDATE players
    SET
      title      = COALESCE(players.title,      (SELECT title      FROM players WHERE id = ${dropId})),
      federation = COALESCE(players.federation, (SELECT federation FROM players WHERE id = ${dropId}))
    WHERE id = ${keepId}
  `;

  // Inherit fide_id only if: keep has none, AND no other player already holds it
  const [keepRow] = await sql`SELECT fide_id FROM players WHERE id = ${keepId}`;
  const [dropRow] = await sql`SELECT fide_id FROM players WHERE id = ${dropId}`;
  if (!keepRow.fide_id && dropRow.fide_id) {
    const conflict = await sql`
      SELECT 1 FROM players WHERE fide_id = ${dropRow.fide_id} AND id != ${dropId} AND id != ${keepId} LIMIT 1
    `;
    if (conflict.length === 0) {
      try {
        await sql`UPDATE players SET fide_id = ${dropRow.fide_id} WHERE id = ${keepId}`;
      } catch (e) {
        if (e.code !== "23505") throw e; // only swallow unique constraint violations
      }
    }
  }

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
// Phase 0: Delete corrupted player entries (colon-joined names are parsing
//          artifacts where two player names got concatenated, e.g.
//          "Adams, Michael:Mortazavi, Ali"). Remove their opponent pairs first.
// ---------------------------------------------------------------------------
async function phase0CorruptedNames(dryRun) {
  console.log("\n=== Phase 0: Corrupted name entries (colon artifacts) ===");

  const corrupt = await sql`SELECT id, name FROM players WHERE name LIKE '%:%' ORDER BY name`;
  console.log(`  Found ${corrupt.length} corrupted entries`);

  if (corrupt.length === 0) return 0;

  for (const p of corrupt) {
    const pairCount = (await sql`
      SELECT COUNT(*) AS n FROM opponents WHERE player_a_id = ${p.id} OR player_b_id = ${p.id}
    `)[0].n;

    if (dryRun) {
      console.log(`  [DRY-RUN] Delete "${p.name}" (id=${p.id}, ${pairCount} opponent pairs)`);
    } else {
      await sql`DELETE FROM opponents WHERE player_a_id = ${p.id} OR player_b_id = ${p.id}`;
      await sql`DELETE FROM players WHERE id = ${p.id}`;
      console.log(`  Deleted "${p.name}" (${pairCount} pairs removed)`);
    }
  }

  return corrupt.length;
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
// Phase 2: Abbreviated/truncated-name duplicates
//   ("Lastname, G" → "Lastname, Garry", "Lastname, Gar" → "Lastname, Garry", etc.)
//   Uses prefix matching with no character limit: if one player's first name
//   is a proper prefix of another's, the shorter one is merged into the longer.
//   Always keeps the longer (fuller) name as canonical.
// ---------------------------------------------------------------------------
async function phase2AbbreviatedNames(dryRun) {
  console.log("\n=== Phase 2: Abbreviated/truncated-name duplicates ===");

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
    if (commaIdx === -1) continue;
    const lastName = p.name.substring(0, commaIdx).trim().toLowerCase();
    const firstName = p.name.substring(commaIdx + 1).trim();
    if (!firstName) continue;
    if (!byLastName.has(lastName)) byLastName.set(lastName, []);
    byLastName.get(lastName).push({ ...p, firstName });
  }

  let merged = 0;
  let ambiguous = 0;

  for (const [, players] of byLastName) {
    if (players.length < 2) continue;

    // Sort by first name length ascending — process more-abbreviated names first
    const sorted = [...players].sort((a, b) => a.firstName.length - b.firstName.length);
    // Track players dropped within this group so they're excluded from further matching
    const dropped = new Set();

    for (const player of sorted) {
      if (dropped.has(player.id)) continue;

      // Skip corrupted entries (colon-joined names are parsing artifacts)
      if (player.name.includes(":")) continue;

      // Strip trailing period before comparison ("G." → "G", "Gar." → "Gar")
      const firstNorm = player.firstName.replace(/\.\s*$/, "").trim().toUpperCase();
      if (!firstNorm) continue;

      // Find all same-group players whose first name starts with this player's
      // first name AND is strictly longer (this player is an abbreviated form)
      const matches = players.filter(q =>
        q.id !== player.id &&
        !dropped.has(q.id) &&
        !q.name.includes(":") &&           // exclude corrupted entries as merge targets
        q.firstName.toUpperCase().startsWith(firstNorm) &&
        q.firstName.length > player.firstName.length
      );

      if (matches.length === 0) continue;

      if (matches.length > 1) {
        ambiguous++;
        if (dryRun) {
          console.log(`  [AMBIGUOUS] "${player.name}" matches ${matches.map(m => `"${m.name}"`).join(", ")}`);
        }
        continue;
      }

      // Exactly one match — merge the shorter name into the longer one
      const canonical = matches[0];
      const keepId   = canonical.id;
      const keepName = canonical.name;
      const dropId   = player.id;
      const dropName = player.name;

      if (dryRun) {
        console.log(`  [DRY-RUN] Merge "${dropName}" (id=${dropId}) → "${keepName}" (id=${keepId})`);
      } else {
        process.stdout.write(`  Merging "${dropName}" → "${keepName}" ...`);
        await mergeInto(keepId, dropId, false);
        process.stdout.write(" done\n");
      }
      merged++;
      dropped.add(dropId);
    }
  }

  console.log(`  Merged ${merged} abbreviated/truncated duplicates`);
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

  const corruptDeleted = await phase0CorruptedNames(DRY_RUN);
  const exactMerged    = await phase1ExactDuplicates(DRY_RUN);
  const abbrevMerged   = await phase2AbbreviatedNames(DRY_RUN);

  const after = await sql`SELECT (SELECT count(*) FROM players) AS p, (SELECT count(*) FROM opponents) AS o`;
  console.log(`\n=== Summary ===`);
  console.log(`  Corrupted entries deleted:     ${corruptDeleted}`);
  console.log(`  Exact duplicates merged:       ${exactMerged}`);
  console.log(`  Abbreviated duplicates merged: ${abbrevMerged}`);
  console.log(`  Total:                         ${corruptDeleted + exactMerged + abbrevMerged}`);

  if (!DRY_RUN) {
    console.log(`\nBefore: ${before[0].p} players, ${before[0].o} opponent pairs`);
    console.log(`After:  ${after[0].p} players, ${after[0].o} opponent pairs`);
  }
}

main().catch(console.error);
