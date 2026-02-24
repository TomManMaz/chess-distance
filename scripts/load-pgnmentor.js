const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { neon } = require("@neondatabase/serverless");

const DATA_DIR = path.join(__dirname, "..", "data", "pgnmentor");
const DB_URL = process.env.DATABASE_URL;
const CONC = 20;

const PLAYERS = [
  "Abdusattorov","Adams","Akobian","Akopian","Alburt","Alekhine","Alekseev","Almasi",
  "Anand","Anderssen","Andersson","Andreikin","Aronian","Ashley","Averbakh",
  "Azmaiparashvili","Bacrot","Bareev","BecerraRivero","Beliavsky","Benjamin","Benko",
  "Berliner","Bernstein","Bird","Bisguier","Blackburne","Blatny","Bogoljubow",
  "Boleslavsky","Bologan","Botvinnik","Breyer","Bronstein","Browne","Bruzon","Bu","Byrne",
  "Capablanca","Carlsen","Caruana","Chiburdanidze","Chigorin","Christiansen",
  "DeFirmian","DeLaBourdonnais","Denker","Ding","DominguezPerez","Dreev","Duda",
  "Dzindzichashvili","Ehlvest","Eljanov","Erigaisi","Euwe","Evans","Fedorowicz",
  "Fine","Finegold","Firouzja","Fischer","Fishbein","Flohr","Gaprindashvili",
  "Gashimov","Gelfand","Geller","Georgiev","Giri","Gligoric","Goldin","GrandaZuniga",
  "Grischuk","Gukesh","Gulko","Gunsberg","GurevichD","GurevichM","Harikrishna","Hort",
  "Horwitz","Hou","Huebner","Ibragimov","IllescasCordoba","Inarkiev","Ivanchuk",
  "IvanovA","IvanovI","Ivkov","Jakovenko","Janowski","Jobava","Jussupow","Kaidanov",
  "Kamsky","Karjakin","Karpov","Kasimdzhanov","Kasparov","Kavalek","Keres","Keymer",
  "Khalifman","Kholmov","Koneru","Korchnoi","Korobov","Kosteniuk","Kotov","Kramnik",
  "Krasenkow","Krush","Kudrin","Lahno","Larsen","Lasker","Lautier","Le","Leko",
  "Levenfish","Li","Lilienthal","Ljubojevic","Lputian",
  "MacKenzie","Mamedyarov","Marshall","Maroczy","Mason","Mecking","Mieses",
  "Miles","Milov","Morozevich","Morphy","Movsesian","Muzychuk","Naiditsch",
  "Najdorf","Nakamura","Navara","Nepomniachtchi","Ni","Nigalidze","Nikolic","Nimzowitsch",
  "Nunn","Onischuk","Oparin","Panno","Paulsen","Petrosian","Philidor","Piket",
  "Pillsbury","Polgar","Polugaevsky","Ponomariov","Portisch","Praggnanandhaa",
  "Psakhis","Radjabov","Ragozin","Rapport","Rashid","Reshevsky","Reti","Robson",
  "Rodshtein","Romanishin","Rubinstein","Saemisch","Salov","Schlechter","Seirawan",
  "Shabalov","Shirov","Shulman","Short","Smeets","Smirin","Smyslov","So","Sokolov",
  "Spassky","Spielmann","Stefanova","Steinitz","Stripunsky","Suetin","Sultanov",
  "Svidler","Sveshnikov","Szabo","Tal","Tarjan","Tarrasch","Tartakower","Teichmann",
  "Timman","Tiviakov","Tkachiev","Topalov","Torre","Vaganian","ValleBogaert",
  "VanWely","Vachier-Lagrave","Vidit","Vidmar","Vitiugov","Volokitin","Wang","Wei",
  "Wojtaszek","Xiangzhi","Xu","Yifan","Yu","Zukertort","Zvjaginsev"
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const get = url.startsWith("https") ? https.get : http.get;
    get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error("HTTP " + res.statusCode));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", reject);
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
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Phase 1: Download all player zip files
  console.log(`=== Phase 1: Downloading ${PLAYERS.length} player files from PGN Mentor ===`);
  let downloaded = 0, failed = 0;

  for (const player of PLAYERS) {
    const zipPath = path.join(DATA_DIR, player + ".zip");
    const pgnPath = path.join(DATA_DIR, player + ".pgn");

    if (fs.existsSync(pgnPath)) { continue; }

    const url = `https://www.pgnmentor.com/players/${player}.zip`;
    try {
      if (!fs.existsSync(zipPath)) {
        await download(url, zipPath);
      }
      // Extract
      const zpw = zipPath.replace(/\//g, "\\");
      const pdw = DATA_DIR.replace(/\//g, "\\");
      execSync(
        `powershell.exe -Command "Expand-Archive -Path '${zpw}' -DestinationPath '${pdw}' -Force"`,
        { stdio: "pipe", timeout: 30000 }
      );
      downloaded++;
      if (downloaded % 20 === 0) console.log(`  Downloaded: ${downloaded}`);
    } catch (e) {
      failed++;
    }
  }
  console.log(`Downloaded: ${downloaded}, Failed: ${failed}\n`);

  // Also download TWIC PGNs already in data/pgn
  const twicDir = path.join(__dirname, "..", "data", "pgn");

  // Phase 2: Parse all PGN files
  console.log("=== Phase 2: Parsing all PGN files ===");
  const playersByKey = new Map();
  const pairCounts = new Map();
  let totalGames = 0;

  function processFile(filePath, label) {
    const games = parsePgn(filePath);
    totalGames += games.length;
    for (const g of games) {
      const wFide = g.WhiteFideId ? parseInt(g.WhiteFideId) || null : null;
      const bFide = g.BlackFideId ? parseInt(g.BlackFideId) || null : null;
      const wKey = wFide ? `fide:${wFide}` : `name:${g.White.toLowerCase().trim()}`;
      const bKey = bFide ? `fide:${bFide}` : `name:${g.Black.toLowerCase().trim()}`;

      if (!playersByKey.has(wKey))
        playersByKey.set(wKey, { name: g.White, fide_id: wFide, title: g.WhiteTitle || null });
      if (!playersByKey.has(bKey))
        playersByKey.set(bKey, { name: g.Black, fide_id: bFide, title: g.BlackTitle || null });
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
    return games.length;
  }

  // Parse PGN Mentor files
  const mentorFiles = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".pgn")).sort();
  console.log(`PGN Mentor: ${mentorFiles.length} files`);
  for (const file of mentorFiles) {
    const count = processFile(path.join(DATA_DIR, file), file);
    if (mentorFiles.indexOf(file) % 50 === 0)
      process.stdout.write(`  ${file}: ${count} games (total: ${totalGames})\n`);
  }

  // Parse TWIC files
  if (fs.existsSync(twicDir)) {
    const twicFiles = fs.readdirSync(twicDir).filter(f => f.endsWith(".pgn")).sort();
    console.log(`TWIC: ${twicFiles.length} files`);
    for (const file of twicFiles) {
      processFile(path.join(twicDir, file), file);
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
      } catch (e) {}
    });
    await Promise.all(promises);
    if ((i + CONC) % 5000 < CONC) {
      process.stdout.write(`  Players: ${Math.min(i + CONC, entries.length)}/${entries.length}\n`);
    }
  }
  console.log(`Inserted ${keyToId.size} players`);

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
      try {
        await sql`
          INSERT INTO opponents (player_a_id, player_b_id, game_count, first_game_date, last_game_date)
          VALUES (${sId}, ${bId}, ${data.count}, ${data.first}, ${data.last})
          ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET
            game_count = opponents.game_count + EXCLUDED.game_count,
            first_game_date = LEAST(opponents.first_game_date, EXCLUDED.first_game_date),
            last_game_date = GREATEST(opponents.last_game_date, EXCLUDED.last_game_date)`;
      } catch (e) {}
    });
    await Promise.all(promises);
    if ((i + CONC) % 10000 < CONC) {
      process.stdout.write(`  Pairs: ${Math.min(i + CONC, pairs.length)}/${pairs.length}\n`);
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Players: ${keyToId.size}`);
  console.log(`Opponent pairs: ${pairCounts.size}`);
  console.log(`Total games: ${totalGames}`);
}

main().catch(console.error);
