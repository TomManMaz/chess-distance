const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { neon } = require("@neondatabase/serverless");

const ZIP_DIR = path.join(__dirname, "..", "data", "pgn-zips");
const PGN_DIR = path.join(__dirname, "..", "data", "pgn");
const DB_URL = process.env.DATABASE_URL;
const START = parseInt(process.argv[2] || "920");
const END = parseInt(process.argv[3] || "1600");
const CONC = 20;

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        return reject(new Error("HTTP " + res.statusCode));
      }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", (e) => { file.close(); reject(e); });
  });
}

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
  fs.mkdirSync(ZIP_DIR, { recursive: true });
  fs.mkdirSync(PGN_DIR, { recursive: true });

  // Phase 1: Download all TWIC files
  console.log(`=== Phase 1: Downloading TWIC ${START}-${END} ===`);
  let downloaded = 0, skipped = 0, failed = 0;

  for (let i = START; i <= END; i++) {
    const zipName = `twic${i}g.zip`;
    const zipPath = path.join(ZIP_DIR, zipName);
    const url = `https://theweekinchess.com/zips/${zipName}`;

    // Check if PGN already extracted
    const possiblePgns = fs.readdirSync(PGN_DIR).filter(f =>
      f.toLowerCase().startsWith(`twic${i}`) && f.endsWith(".pgn")
    );
    if (possiblePgns.length > 0) {
      skipped++;
      continue;
    }

    try {
      if (!fs.existsSync(zipPath)) {
        await download(url, zipPath);
      }
      const zpw = zipPath.replace(/\//g, "\\");
      const pdw = PGN_DIR.replace(/\//g, "\\");
      try {
        execSync(
          `powershell.exe -Command "Expand-Archive -Path '${zpw}' -DestinationPath '${pdw}' -Force"`,
          { stdio: "pipe", timeout: 30000 }
        );
      } catch {
        // Try deleting corrupt zip and re-downloading
        try { fs.unlinkSync(zipPath); } catch {}
        failed++;
        continue;
      }
      downloaded++;
      if (downloaded % 50 === 0) {
        console.log(`  Downloaded: ${downloaded}, Skipped: ${skipped}, Failed: ${failed} (at TWIC ${i})`);
      }
    } catch (e) {
      failed++;
    }
  }
  console.log(`Download complete. Downloaded: ${downloaded}, Skipped: ${skipped}, Failed: ${failed}\n`);

  // Phase 2: Parse all PGN files
  console.log("=== Phase 2: Parsing PGN files ===");
  const pgnFiles = fs.readdirSync(PGN_DIR).filter(f => f.endsWith(".pgn")).sort();
  console.log(`Found ${pgnFiles.length} PGN files`);

  const playersByKey = new Map();
  const pairCounts = new Map();
  let totalGames = 0;

  for (const file of pgnFiles) {
    const games = parsePgn(path.join(PGN_DIR, file));
    totalGames += games.length;
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
    if (pgnFiles.indexOf(file) % 100 === 0) {
      process.stdout.write(`  Parsed ${pgnFiles.indexOf(file) + 1}/${pgnFiles.length} files, ${totalGames} games so far\n`);
    }
  }

  console.log(`\nTotal games: ${totalGames}`);
  console.log(`Unique players: ${playersByKey.size}`);
  console.log(`Unique opponent pairs: ${pairCounts.size}\n`);

  // Phase 3: Insert into database
  if (!DB_URL) { console.error("No DATABASE_URL"); process.exit(1); }
  const sql = neon(DB_URL);

  await sql`TRUNCATE opponents CASCADE`;
  await sql`TRUNCATE players CASCADE`;
  console.log("=== Phase 3: Loading into database ===");

  // Insert players with concurrency
  console.log("Inserting players...");
  const keyToId = new Map();
  const entries = [...playersByKey.entries()];

  for (let i = 0; i < entries.length; i += CONC) {
    const batch = entries.slice(i, i + CONC);
    const promises = batch.map(async ([key, p]) => {
      try {
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
      } catch (e) {
        // Skip duplicates silently
      }
    });
    await Promise.all(promises);
    if ((i + CONC) % 5000 < CONC) {
      process.stdout.write(`  Players: ${Math.min(i + CONC, entries.length)}/${entries.length}\n`);
    }
  }
  console.log(`Inserted ${keyToId.size} players`);

  // Insert opponent pairs with concurrency
  console.log("Inserting opponent pairs...");
  const pairs = [...pairCounts.entries()];
  let insertedPairs = 0;

  for (let i = 0; i < pairs.length; i += CONC) {
    const batch = pairs.slice(i, i + CONC);
    const promises = batch.map(async ([pk, data]) => {
      const [keyA, keyB] = pk.split("||");
      const idA = keyToId.get(keyA);
      const idB = keyToId.get(keyB);
      if (!idA || !idB) return;
      const [sId, bId] = idA < idB ? [idA, idB] : [idB, idA];
      try {
        await sql`
          INSERT INTO opponents (player_a_id, player_b_id, game_count, first_game_date, last_game_date)
          VALUES (${sId}, ${bId}, ${data.count}, ${data.first}, ${data.last})
          ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET
            game_count = opponents.game_count + EXCLUDED.game_count,
            first_game_date = LEAST(opponents.first_game_date, EXCLUDED.first_game_date),
            last_game_date = GREATEST(opponents.last_game_date, EXCLUDED.last_game_date)`;
        insertedPairs++;
      } catch (e) {
        // Skip errors
      }
    });
    await Promise.all(promises);
    if ((i + CONC) % 10000 < CONC) {
      process.stdout.write(`  Pairs: ${Math.min(i + CONC, pairs.length)}/${pairs.length}\n`);
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Players: ${keyToId.size}`);
  console.log(`Opponent pairs: ${insertedPairs}`);
  console.log(`Total games processed: ${totalGames}`);
}

main().catch(console.error);
