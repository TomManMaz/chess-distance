const fs = require("fs");
const path = require("path");
const postgres = require("postgres");

const PGN_DIR = path.join(__dirname, "..", "data", "pgn");
const DB_URL = process.env.DATABASE_URL;

function parseHeader(line) {
  const m = line.match(/^\[(\w+)\s+"(.*)"\]$/);
  return m ? [m[1], m[2]] : null;
}

function parsePgn(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const games = [];
  let cur = {};
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (t.startsWith("[")) {
      const p = parseHeader(t);
      if (p) cur[p[0]] = p[1];
    } else if (t === "" && cur.White && cur.Black) {
      if (cur.White !== "?" && cur.Black !== "?" && cur.White !== cur.Black) {
        games.push({ ...cur });
      }
      cur = {};
    }
  }
  return games;
}

async function main() {
  if (!DB_URL) { console.error("Set DATABASE_URL"); process.exit(1); }
  const sql = postgres(DB_URL, { max: 1 });

  await sql`TRUNCATE opponents CASCADE`;
  await sql`TRUNCATE players CASCADE`;
  console.log("Cleared existing data");

  const pgnFiles = fs.readdirSync(PGN_DIR).filter(f => f.endsWith(".pgn")).sort();
  console.log(`Parsing ${pgnFiles.length} PGN files...`);

  const playersByKey = new Map();
  const pairCounts = new Map();

  for (const file of pgnFiles) {
    const games = parsePgn(path.join(PGN_DIR, file));
    process.stdout.write(`  ${file}: ${games.length} games\n`);
    for (const g of games) {
      const wFide = g.WhiteFideId ? parseInt(g.WhiteFideId) || null : null;
      const bFide = g.BlackFideId ? parseInt(g.BlackFideId) || null : null;
      const wKey = wFide ? `fide:${wFide}` : `name:${g.White.toLowerCase().trim()}`;
      const bKey = bFide ? `fide:${bFide}` : `name:${g.Black.toLowerCase().trim()}`;

      if (!playersByKey.has(wKey)) {
        playersByKey.set(wKey, { name: g.White, fide_id: wFide, title: g.WhiteTitle || null });
      }
      if (!playersByKey.has(bKey)) {
        playersByKey.set(bKey, { name: g.Black, fide_id: bFide, title: g.BlackTitle || null });
      }
      if (g.WhiteTitle && !playersByKey.get(wKey).title) playersByKey.get(wKey).title = g.WhiteTitle;
      if (g.BlackTitle && !playersByKey.get(bKey).title) playersByKey.get(bKey).title = g.BlackTitle;

      if (wKey === bKey) continue;
      const pk = wKey < bKey ? `${wKey}||${bKey}` : `${bKey}||${wKey}`;
      let date = g.Date ? g.Date.replace(/\./g, "-") : null;
      // Validate date format YYYY-MM-DD
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) date = null;
      const existing = pairCounts.get(pk);
      if (existing) {
        existing.count++;
        if (date && (!existing.first || date < existing.first)) existing.first = date;
        if (date && (!existing.last || date > existing.last)) existing.last = date;
      } else {
        pairCounts.set(pk, { count: 1, first: date, last: date });
      }
    }
  }

  console.log(`\nUnique players: ${playersByKey.size}`);
  console.log(`Unique opponent pairs: ${pairCounts.size}`);

  // Insert players one by one (using tagged template) but with concurrency
  console.log("\nInserting players...");
  const keyToId = new Map();
  const entries = [...playersByKey.entries()];
  const CONC = 20; // concurrent requests

  for (let i = 0; i < entries.length; i += CONC) {
    const batch = entries.slice(i, i + CONC);
    const promises = batch.map(async ([key, p]) => {
      let rows;
      if (p.fide_id) {
        rows = await sql`
          INSERT INTO players (name, fide_id, title)
          VALUES (${p.name}, ${p.fide_id}, ${p.title})
          ON CONFLICT (fide_id) DO UPDATE SET
            name = COALESCE(EXCLUDED.name, players.name),
            title = COALESCE(EXCLUDED.title, players.title)
          RETURNING id`;
      } else {
        rows = await sql`INSERT INTO players (name, title) VALUES (${p.name}, ${p.title}) RETURNING id`;
      }
      keyToId.set(key, rows[0].id);
    });
    await Promise.all(promises);
    if ((i + CONC) % 1000 < CONC) {
      process.stdout.write(`  ${Math.min(i + CONC, entries.length)}/${entries.length}\n`);
    }
  }
  console.log(`Inserted ${keyToId.size} players`);

  // Insert opponent pairs with concurrency
  console.log("Inserting opponent pairs...");
  const pairs = [...pairCounts.entries()];

  for (let i = 0; i < pairs.length; i += CONC) {
    const batch = pairs.slice(i, i + CONC);
    const promises = batch.map(async ([pk, data]) => {
      const [keyA, keyB] = pk.split("||");
      const idA = keyToId.get(keyA);
      const idB = keyToId.get(keyB);
      if (!idA || !idB) return;
      const [sId, bId] = idA < idB ? [idA, idB] : [idB, idA];
      await sql`
        INSERT INTO opponents (player_a_id, player_b_id, game_count, first_game_date, last_game_date)
        VALUES (${sId}, ${bId}, ${data.count}, ${data.first}, ${data.last})
        ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET
          game_count = opponents.game_count + EXCLUDED.game_count,
          first_game_date = LEAST(opponents.first_game_date, EXCLUDED.first_game_date),
          last_game_date = GREATEST(opponents.last_game_date, EXCLUDED.last_game_date)`;
    });
    await Promise.all(promises);
    if ((i + CONC) % 5000 < CONC) {
      process.stdout.write(`  ${Math.min(i + CONC, pairs.length)}/${pairs.length}\n`);
    }
  }

  console.log("\nDone!");
}

main().catch(console.error);
