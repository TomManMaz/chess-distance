const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const postgres = require("postgres");

const DATA_DIR = path.join(__dirname, "..", "data", "pgnmentor");
const DB_URL = process.env.DATABASE_URL;
const CONC = 20;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

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
  "Najdorf","Nakamura","Navara","Nepomniachtchi","Ni","Nikolic","Nimzowitsch",
  "Nunn","Onischuk","Oparin","Panno","Paulsen","Petrosian","Philidor","Piket",
  "Pillsbury","Polgar","Polugaevsky","Ponomariov","Portisch","Praggnanandhaa",
  "Psakhis","Radjabov","Ragozin","Rapport","Reshevsky","Reti","Robson",
  "Rodshtein","Romanishin","Rubinstein","Saemisch","Salov","Schlechter","Seirawan",
  "Shabalov","Shirov","Shulman","Short","Smeets","Smirin","Smyslov","So","Sokolov",
  "Spassky","Spielmann","Stefanova","Steinitz","Stripunsky","Suetin",
  "Svidler","Sveshnikov","Szabo","Tal","Tarjan","Tarrasch","Tartakower","Teichmann",
  "Timman","Tiviakov","Tkachiev","Topalov","Torre","Vaganian",
  "VanWely","Vachier-Lagrave","Vidit","Vidmar","Vitiugov","Volokitin","Wang","Wei",
  "Wojtaszek","Xu","Yu","Zukertort","Zvjaginsev"
];

function download(playerName, dest) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "www.pgnmentor.com",
      path: `/players/${playerName}.zip`,
      headers: { "User-Agent": UA }
    };
    https.get(options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // follow redirect
        const loc = res.headers.location;
        if (loc) {
          const url = new URL(loc, "https://www.pgnmentor.com");
          const opts2 = { hostname: url.hostname, path: url.pathname, headers: { "User-Agent": UA } };
          const getter = url.protocol === "https:" ? https : require("http");
          getter.get(opts2, (res2) => {
            if (res2.statusCode !== 200) return reject(new Error("HTTP " + res2.statusCode));
            const file = fs.createWriteStream(dest);
            res2.pipe(file);
            file.on("finish", () => { file.close(); resolve(); });
          }).on("error", reject);
        } else reject(new Error("No location"));
        return;
      }
      if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
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

// Classify a game's time control into 'classical', 'rapid', or 'blitz'.
// Uses FIDE boundaries: classical ≥ 25min effective, rapid 10-25min, blitz < 10min.
// Normalize a player name from a PGN header.
// Ensures a space after the comma: "Karpov,Anatoly" → "Karpov, Anatoly"
function normalizeName(name) {
  return name.replace(/,([^\s])/, ", $1").trim();
}

function classifyTimeControl(tc, event) {
  // Check event name for obvious clues when TC header is absent
  if (event && event !== "?") {
    const ev = event.toLowerCase();
    if (/\bblitz\b|\bbullet\b|\blightning\b|\bblindblitz\b/.test(ev)) return "blitz";
    if (/\brapid\b/.test(ev)) return "rapid";
  }
  if (!tc || tc === "?" || tc === "-" || tc === "") return "classical";
  // Moves-in-time format like "40/7200" → classical
  if (/^\d+\//.test(tc)) return "classical";
  // Standard "base+increment" in seconds
  const m = tc.match(/^(\d+)(?:\+(\d+))?/);
  if (!m) return "classical";
  const base = parseInt(m[1]);
  const inc = parseInt(m[2] || "0");
  const effectiveSecs = base + 40 * inc;
  if (effectiveSecs >= 1500) return "classical";
  if (effectiveSecs >= 600) return "rapid";
  return "blitz";
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

  // Phase 1: Download
  console.log(`=== Phase 1: Downloading ${PLAYERS.length} player files ===`);
  let downloaded = 0, skipped = 0, failed = 0;

  for (let i = 0; i < PLAYERS.length; i++) {
    const player = PLAYERS[i];
    const zipPath = path.join(DATA_DIR, player + ".zip");
    const pgnGlob = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".pgn") && f.toLowerCase().startsWith(player.toLowerCase()));

    if (pgnGlob.length > 0) { skipped++; continue; }

    try {
      if (!fs.existsSync(zipPath)) {
        await download(player, zipPath);
      }
      const zpw = zipPath.replace(/\//g, "\\");
      const pdw = DATA_DIR.replace(/\//g, "\\");
      execSync(
        `powershell.exe -Command "Expand-Archive -Path '${zpw}' -DestinationPath '${pdw}' -Force"`,
        { stdio: "pipe", timeout: 30000 }
      );
      downloaded++;
    } catch (e) {
      failed++;
    }

    const pct = Math.round(((i + 1) / PLAYERS.length) * 100);
    const bar = "█".repeat(Math.floor(pct / 3.33)) + "░".repeat(30 - Math.floor(pct / 3.33));
    process.stdout.write(`\r  [${bar}] ${pct}% (${i + 1}/${PLAYERS.length}) ${player.padEnd(20)}`);
  }
  console.log(`\n  Done. Downloaded: ${downloaded}, Skipped: ${skipped}, Failed: ${failed}\n`);

  // Phase 2: Parse
  console.log("=== Phase 2: Parsing PGN files ===");
  const playersByKey = new Map();
  const pairCounts = new Map();
  let totalGames = 0;

  function processFile(filePath) {
    const games = parsePgn(filePath);
    totalGames += games.length;
    for (const g of games) {
      const wFide = g.WhiteFideId ? parseInt(g.WhiteFideId) || null : null;
      const bFide = g.BlackFideId ? parseInt(g.BlackFideId) || null : null;
      const wName = normalizeName(g.White);
      const bName = normalizeName(g.Black);
      const wKey = wFide ? `fide:${wFide}` : `name:${wName.toLowerCase()}`;
      const bKey = bFide ? `fide:${bFide}` : `name:${bName.toLowerCase()}`;
      if (!playersByKey.has(wKey))
        playersByKey.set(wKey, { name: wName, fide_id: wFide, title: g.WhiteTitle || null });
      if (!playersByKey.has(bKey))
        playersByKey.set(bKey, { name: bName, fide_id: bFide, title: g.BlackTitle || null });
      if (g.WhiteTitle && !playersByKey.get(wKey).title) playersByKey.get(wKey).title = g.WhiteTitle;
      if (g.BlackTitle && !playersByKey.get(bKey).title) playersByKey.get(bKey).title = g.BlackTitle;
      if (wKey === bKey) continue;
      const pk = wKey < bKey ? `${wKey}||${bKey}` : `${bKey}||${wKey}`;
      let date = g.Date ? g.Date.replace(/\./g, "-") : null;
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) date = null;
      const tc = classifyTimeControl(g.TimeControl || null, g.Event || null);
      const eventName = (g.Event && g.Event !== "?" && g.Event !== "??" && g.Event.length > 1)
        ? g.Event : null;
      const existing = pairCounts.get(pk);
      if (existing) {
        existing.count++;
        existing[tc]++;
        if (date && (!existing.first || date < existing.first)) existing.first = date;
        if (date && (!existing.last || date > existing.last)) existing.last = date;
        if (!existing.event && eventName) existing.event = eventName;
      } else {
        pairCounts.set(pk, {
          count: 1, first: date, last: date,
          classical: tc === "classical" ? 1 : 0,
          rapid: tc === "rapid" ? 1 : 0,
          blitz: tc === "blitz" ? 1 : 0,
          event: eventName,
        });
      }
    }
    return games.length;
  }

  // PGN Mentor files
  const mentorFiles = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".pgn")).sort();
  console.log(`  PGN Mentor: ${mentorFiles.length} files`);
  for (let i = 0; i < mentorFiles.length; i++) {
    processFile(path.join(DATA_DIR, mentorFiles[i]));
    const pct = Math.round(((i + 1) / mentorFiles.length) * 100);
    const bar = "█".repeat(Math.floor(pct / 3.33)) + "░".repeat(30 - Math.floor(pct / 3.33));
    process.stdout.write(`\r  [${bar}] ${pct}% (${i + 1}/${mentorFiles.length})`);
  }
  console.log("");

  // TWIC files
  const twicDir = path.join(__dirname, "..", "data", "pgn");
  if (fs.existsSync(twicDir)) {
    const twicFiles = fs.readdirSync(twicDir).filter(f => f.endsWith(".pgn")).sort();
    console.log(`  TWIC: ${twicFiles.length} files`);
    for (let i = 0; i < twicFiles.length; i++) {
      processFile(path.join(twicDir, twicFiles[i]));
      const pct = Math.round(((i + 1) / twicFiles.length) * 100);
      const bar = "█".repeat(Math.floor(pct / 3.33)) + "░".repeat(30 - Math.floor(pct / 3.33));
      process.stdout.write(`\r  [${bar}] ${pct}% (${i + 1}/${twicFiles.length})`);
    }
    console.log("");
  }

  console.log(`\n  Total games: ${totalGames}`);
  console.log(`  Unique players: ${playersByKey.size}`);
  console.log(`  Unique opponent pairs: ${pairCounts.size}`);

  // Phase 2b: Normalize abbreviated names in-memory before DB insertion
  // Groups name: keys by last name, finds abbreviated entries (single initial),
  // and if exactly one full-name match exists, remaps the abbreviated key → full key.
  console.log("\n=== Phase 2b: Normalizing abbreviated names ===");
  {
    // Match 1–4 letter first-name abbreviations (with optional trailing period)
    // e.g. ", A" / ", G." / ", Ana" / ", Gar"
    const ABBREV_RE = /^,\s*([A-Za-z]{1,4})\.?\s*$/;

    // Collect only name: keys (not fide: keys)
    const nameKeys = [...playersByKey.keys()].filter(k => k.startsWith("name:"));

    // Group by last name (text before first comma in the actual name)
    const byLastName = new Map();
    for (const key of nameKeys) {
      const player = playersByKey.get(key);
      const commaIdx = player.name.indexOf(",");
      if (commaIdx === -1) continue;
      const lastName = player.name.substring(0, commaIdx).trim().toLowerCase();
      if (!byLastName.has(lastName)) byLastName.set(lastName, []);
      byLastName.get(lastName).push({ key, player });
    }

    const redirects = new Map(); // abbrevKey → fullKey
    let normalized = 0, ambiguous = 0;

    for (const [, entries] of byLastName) {
      if (entries.length < 2) continue;

      const abbreviated = [];
      const fullName = [];

      for (const entry of entries) {
        const afterComma = entry.player.name.substring(entry.player.name.indexOf(","));
        if (ABBREV_RE.test(afterComma)) {
          const abbrev = afterComma.match(ABBREV_RE)[1].toUpperCase();
          abbreviated.push({ ...entry, abbrev });
        } else {
          fullName.push(entry);
        }
      }

      if (abbreviated.length === 0) continue;

      for (const abbrevEntry of abbreviated) {
        const matches = fullName.filter(fp => {
          const afterComma = fp.player.name.substring(fp.player.name.indexOf(",") + 1).trim();
          return afterComma.toUpperCase().startsWith(abbrevEntry.abbrev);
        });

        if (matches.length !== 1) {
          if (matches.length > 1) ambiguous++;
          continue;
        }

        // Exactly one match — redirect abbrev → full
        redirects.set(abbrevEntry.key, matches[0].key);
        normalized++;
      }
    }

    // Apply redirects to pairCounts
    if (redirects.size > 0) {
      const newPairCounts = new Map();
      for (const [pk, data] of pairCounts) {
        const [keyA, keyB] = pk.split("||");
        const resolvedA = redirects.get(keyA) || keyA;
        const resolvedB = redirects.get(keyB) || keyB;
        if (resolvedA === resolvedB) continue; // would be a self-loop
        const newPk = resolvedA < resolvedB ? `${resolvedA}||${resolvedB}` : `${resolvedB}||${resolvedA}`;
        const existing = newPairCounts.get(newPk);
        if (existing) {
          existing.count += data.count;
          existing.classical += data.classical || 0;
          existing.rapid += data.rapid || 0;
          existing.blitz += data.blitz || 0;
          if (!existing.event && data.event) existing.event = data.event;
          if (data.first && (!existing.first || data.first < existing.first)) existing.first = data.first;
          if (data.last && (!existing.last || data.last > existing.last)) existing.last = data.last;
        } else {
          newPairCounts.set(newPk, { ...data });
        }
      }
      pairCounts.clear();
      for (const [k, v] of newPairCounts) pairCounts.set(k, v);

      // Remove redirected abbreviated keys from playersByKey
      for (const abbrevKey of redirects.keys()) {
        playersByKey.delete(abbrevKey);
      }
    }

    console.log(`  Normalized ${normalized} abbreviated name redirects`);
    console.log(`  Skipped ${ambiguous} ambiguous cases`);
    console.log(`  Players after normalization: ${playersByKey.size}`);
    console.log(`  Pairs after normalization:   ${pairCounts.size}\n`);
  }

  // Phase 3: DB insert
  if (!DB_URL) { console.error("No DATABASE_URL"); process.exit(1); }
  const sql = postgres(DB_URL, { max: 1 });
  await sql`TRUNCATE opponents CASCADE`;
  await sql`TRUNCATE players CASCADE`;
  console.log("=== Phase 3: Loading into database ===");

  const keyToId = new Map();
  const entries = [...playersByKey.entries()];
  console.log(`  Inserting ${entries.length} players...`);

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
    const pct = Math.round(((i + CONC) / entries.length) * 100);
    const bar = "█".repeat(Math.floor(pct / 3.33)) + "░".repeat(30 - Math.floor(pct / 3.33));
    process.stdout.write(`\r  [${bar}] ${Math.min(pct, 100)}% (${Math.min(i + CONC, entries.length)}/${entries.length})`);
  }
  console.log(`\n  Inserted ${keyToId.size} players`);

  const pairs = [...pairCounts.entries()];
  console.log(`  Inserting ${pairs.length} opponent pairs...`);

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
          INSERT INTO opponents (player_a_id, player_b_id, game_count, first_game_date, last_game_date, classical_count, rapid_count, blitz_count, event_sample)
          VALUES (${sId}, ${bId}, ${data.count}, ${data.first}, ${data.last}, ${data.classical || 0}, ${data.rapid || 0}, ${data.blitz || 0}, ${data.event || null})
          ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET
            game_count = opponents.game_count + EXCLUDED.game_count,
            first_game_date = LEAST(opponents.first_game_date, EXCLUDED.first_game_date),
            last_game_date = GREATEST(opponents.last_game_date, EXCLUDED.last_game_date),
            classical_count = opponents.classical_count + EXCLUDED.classical_count,
            rapid_count = opponents.rapid_count + EXCLUDED.rapid_count,
            blitz_count = opponents.blitz_count + EXCLUDED.blitz_count,
            event_sample = COALESCE(opponents.event_sample, EXCLUDED.event_sample)`;
      } catch (e) {}
    });
    await Promise.all(promises);
    const pct = Math.round(((i + CONC) / pairs.length) * 100);
    const bar = "█".repeat(Math.floor(pct / 3.33)) + "░".repeat(30 - Math.floor(pct / 3.33));
    process.stdout.write(`\r  [${bar}] ${Math.min(pct, 100)}% (${Math.min(i + CONC, pairs.length)}/${pairs.length})`);
  }

  console.log(`\n\n=== ALL DONE ===`);
  console.log(`  Players: ${keyToId.size}`);
  console.log(`  Opponent pairs: ${pairCounts.size}`);
  console.log(`  Total games: ${totalGames}`);
}

main().catch(console.error);
