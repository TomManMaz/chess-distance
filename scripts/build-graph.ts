import { readFileSync } from "fs";
import { join } from "path";
import { neon } from "@neondatabase/serverless";

const GAMES_FILE = join(__dirname, "..", "data", "games.jsonl");
const BATCH_SIZE = 1000;

interface GameRecord {
  white: string;
  black: string;
  white_elo: number | null;
  black_elo: number | null;
  white_fide_id: number | null;
  black_fide_id: number | null;
  white_title: string | null;
  black_title: string | null;
  event: string | null;
  date: string | null;
  result: string | null;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("Set DATABASE_URL environment variable");
    process.exit(1);
  }

  const sql = neon(dbUrl);

  // Read schema and execute
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  for (const statement of schema.split(";").filter((s) => s.trim())) {
    await sql(statement);
  }
  console.log("Schema created");

  // Read all games
  const content = readFileSync(GAMES_FILE, "utf-8");
  const lines = content.trim().split("\n");
  console.log(`Processing ${lines.length} games`);

  // Build in-memory player map and opponent counts
  // Key players by FIDE ID when available, otherwise by normalized name
  const playersByKey = new Map<
    string,
    {
      name: string;
      fide_id: number | null;
      federation: string | null;
      title: string | null;
    }
  >();
  const opponentCounts = new Map<
    string,
    { count: number; firstDate: string | null; lastDate: string | null }
  >();

  function getPlayerKey(
    name: string,
    fideId: number | null
  ): string {
    if (fideId) return `fide:${fideId}`;
    return `name:${name.toLowerCase().trim()}`;
  }

  function pairKey(keyA: string, keyB: string): string {
    return keyA < keyB ? `${keyA}||${keyB}` : `${keyB}||${keyA}`;
  }

  for (const line of lines) {
    const game: GameRecord = JSON.parse(line);
    const wKey = getPlayerKey(game.white, game.white_fide_id);
    const bKey = getPlayerKey(game.black, game.black_fide_id);

    if (!playersByKey.has(wKey)) {
      playersByKey.set(wKey, {
        name: game.white,
        fide_id: game.white_fide_id,
        federation: null,
        title: game.white_title,
      });
    }
    if (!playersByKey.has(bKey)) {
      playersByKey.set(bKey, {
        name: game.black,
        fide_id: game.black_fide_id,
        federation: null,
        title: game.black_title,
      });
    }

    // Update title if we find one and didn't have it
    const wp = playersByKey.get(wKey)!;
    if (!wp.title && game.white_title) wp.title = game.white_title;
    const bp = playersByKey.get(bKey)!;
    if (!bp.title && game.black_title) bp.title = game.black_title;

    if (wKey === bKey) continue;

    const pk = pairKey(wKey, bKey);
    const existing = opponentCounts.get(pk);
    if (existing) {
      existing.count++;
      if (game.date && (!existing.firstDate || game.date < existing.firstDate))
        existing.firstDate = game.date;
      if (game.date && (!existing.lastDate || game.date > existing.lastDate))
        existing.lastDate = game.date;
    } else {
      opponentCounts.set(pk, {
        count: 1,
        firstDate: game.date,
        lastDate: game.date,
      });
    }
  }

  console.log(`Unique players: ${playersByKey.size}`);
  console.log(`Unique opponent pairs: ${opponentCounts.size}`);

  // Insert players in batches
  const playerKeyToId = new Map<string, number>();
  const playerEntries = [...playersByKey.entries()];

  for (let i = 0; i < playerEntries.length; i += BATCH_SIZE) {
    const batch = playerEntries.slice(i, i + BATCH_SIZE);
    for (const [key, player] of batch) {
      const rows = await sql`
        INSERT INTO players (name, fide_id, federation, title)
        VALUES (${player.name}, ${player.fide_id}, ${player.federation}, ${player.title})
        ON CONFLICT (fide_id) DO UPDATE SET
          name = COALESCE(EXCLUDED.name, players.name),
          title = COALESCE(EXCLUDED.title, players.title)
        RETURNING id
      `;
      playerKeyToId.set(key, rows[0].id as number);
    }
    process.stdout.write(
      `\rInserted players: ${Math.min(i + BATCH_SIZE, playerEntries.length)}/${playerEntries.length}`
    );
  }
  console.log("");

  // Insert opponent pairs in batches
  const pairEntries = [...opponentCounts.entries()];
  for (let i = 0; i < pairEntries.length; i += BATCH_SIZE) {
    const batch = pairEntries.slice(i, i + BATCH_SIZE);
    for (const [pk, data] of batch) {
      const [keyA, keyB] = pk.split("||");
      const idA = playerKeyToId.get(keyA);
      const idB = playerKeyToId.get(keyB);
      if (!idA || !idB) continue;

      const [smallId, bigId] = idA < idB ? [idA, idB] : [idB, idA];

      await sql`
        INSERT INTO opponents (player_a_id, player_b_id, game_count, first_game_date, last_game_date)
        VALUES (${smallId}, ${bigId}, ${data.count}, ${data.firstDate}, ${data.lastDate})
        ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET
          game_count = opponents.game_count + EXCLUDED.game_count,
          first_game_date = LEAST(opponents.first_game_date, EXCLUDED.first_game_date),
          last_game_date = GREATEST(opponents.last_game_date, EXCLUDED.last_game_date)
      `;
    }
    process.stdout.write(
      `\rInserted opponent pairs: ${Math.min(i + BATCH_SIZE, pairEntries.length)}/${pairEntries.length}`
    );
  }
  console.log("\n\nDone!");
}

main().catch(console.error);
