const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const postgres = require("postgres");

const ZIP_DIR = path.join(__dirname, "..", "data", "pgn-zips");
const PGN_DIR = path.join(__dirname, "..", "data", "pgn");
const DB_URL = process.env.DATABASE_URL;
const START = parseInt(process.argv[2] || "1500");
const END = parseInt(process.argv[3] || "1520");

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

  // Phase 1: Download & extract
  for (let i = START; i <= END; i++) {
    const zipName = `twic${i}g.zip`;
    const zipPath = path.join(ZIP_DIR, zipName);
    const url = `https://theweekinchess.com/zips/${zipName}`;

    try {
      if (!fs.existsSync(zipPath)) {
        process.stdout.write(`Downloading TWIC ${i}...`);
        await download(url, zipPath);
        process.stdout.write(" ok\n");
      } else {
        process.stdout.write(`TWIC ${i} already downloaded\n`);
      }
      // Extract using PowerShell
      const zipPathWin = zipPath.replace(/\//g, "\\");
      const pgnDirWin = PGN_DIR.replace(/\//g, "\\");
      execSync(
        `powershell.exe -Command "Expand-Archive -Path '${zipPathWin}' -DestinationPath '${pgnDirWin}' -Force"`,
        { stdio: "pipe" }
      );
    } catch (e) {
      console.log(`Failed TWIC ${i}: ${e.message}`);
    }
  }

  // Phase 2: Parse all PGN files
  const pgnFiles = fs.readdirSync(PGN_DIR).filter(f => f.endsWith(".pgn")).sort();
  console.log(`\nParsing ${pgnFiles.length} PGN files...`);

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
      // Update title if found
      if (g.WhiteTitle && !playersByKey.get(wKey).title) playersByKey.get(wKey).title = g.WhiteTitle;
      if (g.BlackTitle && !playersByKey.get(bKey).title) playersByKey.get(bKey).title = g.BlackTitle;

      if (wKey === bKey) continue;
      const pk = wKey < bKey ? `${wKey}||${bKey}` : `${bKey}||${wKey}`;
      const date = g.Date ? g.Date.replace(/\./g, "-") : null;
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

  // Phase 3: Insert into database
  if (!DB_URL) { console.error("No DATABASE_URL"); process.exit(1); }
  const sql = postgres(DB_URL, { max: 1 });

  console.log("\nInserting players...");
  const keyToId = new Map();
  const entries = [...playersByKey.entries()];
  for (let i = 0; i < entries.length; i++) {
    const [key, p] = entries[i];
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
        // Check if already exists by name
        rows = await sql`SELECT id FROM players WHERE lower(name) = ${p.name.toLowerCase().trim()} AND fide_id IS NULL LIMIT 1`;
        if (rows.length === 0) {
          rows = await sql`INSERT INTO players (name, title) VALUES (${p.name}, ${p.title}) RETURNING id`;
        }
      }
      keyToId.set(key, rows[0].id);
    } catch (e) {
      console.error(`Error inserting player ${p.name}: ${e.message}`);
    }
    if ((i + 1) % 500 === 0) process.stdout.write(`  ${i + 1}/${entries.length}\n`);
  }
  console.log(`Inserted ${keyToId.size} players`);

  console.log("Inserting opponent pairs...");
  const pairs = [...pairCounts.entries()];
  for (let i = 0; i < pairs.length; i++) {
    const [pk, data] = pairs[i];
    const [keyA, keyB] = pk.split("||");
    const idA = keyToId.get(keyA);
    const idB = keyToId.get(keyB);
    if (!idA || !idB) continue;
    const [sId, bId] = idA < idB ? [idA, idB] : [idB, idA];
    try {
      await sql`
        INSERT INTO opponents (player_a_id, player_b_id, game_count, first_game_date, last_game_date)
        VALUES (${sId}, ${bId}, ${data.count}, ${data.first}, ${data.last})
        ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET
          game_count = opponents.game_count + EXCLUDED.game_count,
          first_game_date = LEAST(opponents.first_game_date, EXCLUDED.first_game_date),
          last_game_date = GREATEST(opponents.last_game_date, EXCLUDED.last_game_date)`;
    } catch (e) {
      console.error(`Error inserting pair: ${e.message}`);
    }
    if ((i + 1) % 500 === 0) process.stdout.write(`  ${i + 1}/${pairs.length}\n`);
  }
  console.log(`Done! Inserted ${pairs.length} opponent pairs`);
}

main().catch(console.error);
