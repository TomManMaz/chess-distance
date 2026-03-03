const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { neon } = require("@neondatabase/serverless");

const DATA_DIR = path.join(__dirname, "..", "data", "pgnmentor");
const DB_URL = process.env.DATABASE_URL;
const BATCH_SIZE = 200; // rows per INSERT
const CONC = 10;        // concurrent batch INSERTs

function parseHeader(line) {
  const m = line.match(/^\[(\w+)\s+"(.*)"\]$/);
  return m ? [m[1], m[2]] : null;
}

function normalizeName(name) {
  return name.replace(/,([^\s])/, ", $1").trim();
}

// Validate and normalize a PGN date string.
// Returns "YYYY-MM-DD" or null. Rejects invalid calendar dates like Feb 30, June 31.
function normalizeDate(raw) {
  if (!raw) return null;
  const d = raw.replace(/\./g, "-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const [y, m, day] = d.split("-").map(Number);
  // Use Date to validate (invalid dates like Feb 30 roll over, so getDate() differs)
  const dt = new Date(y, m - 1, day);
  if (dt.getFullYear() !== y || dt.getMonth() + 1 !== m || dt.getDate() !== day) return null;
  return d;
}

function classifyTimeControl(tc, event) {
  if (event && event !== "?") {
    const ev = event.toLowerCase();
    if (/\bblitz\b|\bbullet\b|\blightning\b|\bblindblitz\b|titled.?tue(sday)?/.test(ev)) return "blitz";
    if (/\brapid\b/.test(ev)) return "rapid";
  }
  if (!tc || tc === "?" || tc === "-" || tc === "") return "classical";
  if (/^\d+\//.test(tc)) return "classical";
  const m = tc.match(/^(\d+)(?:\+(\d+))?/);
  if (!m) return "classical";
  const base = parseInt(m[1]);
  const inc = parseInt(m[2] || "0");
  const effectiveSecs = base + 40 * inc;
  if (effectiveSecs >= 1500) return "classical";
  if (effectiveSecs >= 600) return "rapid";
  return "blitz";
}

// Stream-based PGN parser — handles files of any size.
// crlfDelay: Infinity handles Windows \r\n line endings.
function streamPgn(filePath, onGame) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    });
    let cur = {};
    rl.on("line", (line) => {
      const t = line.trim();
      if (t.startsWith("[")) {
        const p = parseHeader(t);
        if (p) cur[p[0]] = p[1];
      } else if (t === "" && cur.White && cur.Black) {
        if (cur.White !== "?" && cur.Black !== "?" && cur.White !== cur.Black) {
          onGame(cur);
        }
        cur = {};
      }
    });
    rl.on("close", () => {
      // Handle last game if file doesn't end with a blank line
      if (cur.White && cur.Black && cur.White !== "?" && cur.Black !== "?" && cur.White !== cur.Black) {
        onGame(cur);
      }
      resolve();
    });
    rl.on("error", reject);
  });
}

async function upsertPairs(sql, resolvedPairs) {
  let inserted = 0;
  const startTime = Date.now();

  for (let i = 0; i < resolvedPairs.length; i += BATCH_SIZE * CONC) {
    const batchPromises = [];

    for (let j = 0; j < CONC && (i + j * BATCH_SIZE) < resolvedPairs.length; j++) {
      const start = i + j * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, resolvedPairs.length);
      const chunk = resolvedPairs.slice(start, end);

      const params = [];
      const valueClauses = [];
      for (let k = 0; k < chunk.length; k++) {
        const p = chunk[k];
        const base = k * 9;
        valueClauses.push(
          `($${base+1}, $${base+2}, $${base+3}, $${base+4}::date, $${base+5}::date, $${base+6}, $${base+7}, $${base+8}, $${base+9})`
        );
        params.push(p.a, p.b, p.count, p.first, p.last, p.classical, p.rapid, p.blitz, p.event);
      }

      const query = `
        INSERT INTO opponents (player_a_id, player_b_id, game_count, first_game_date, last_game_date, classical_count, rapid_count, blitz_count, event_sample)
        VALUES ${valueClauses.join(", ")}
        ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET
          game_count        = opponents.game_count + EXCLUDED.game_count,
          first_game_date   = LEAST(opponents.first_game_date, EXCLUDED.first_game_date),
          last_game_date    = GREATEST(opponents.last_game_date, EXCLUDED.last_game_date),
          classical_count   = opponents.classical_count + EXCLUDED.classical_count,
          rapid_count       = opponents.rapid_count + EXCLUDED.rapid_count,
          blitz_count       = opponents.blitz_count + EXCLUDED.blitz_count,
          event_sample      = COALESCE(opponents.event_sample, EXCLUDED.event_sample)`;

      batchPromises.push(
        sql.query(query, params)
          .then(() => { inserted += chunk.length; })
          .catch(e => { console.error(`\n  Batch error at ${start}: ${e.message.substring(0, 120)}`); })
      );
    }

    await Promise.all(batchPromises);
  }

  return inserted;
}

async function insertNewPlayers(sql, newPlayers, fideToId, nameToId) {
  if (newPlayers.size === 0) return;
  const entries = [...newPlayers.values()];
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    const params = [];
    const valueClauses = [];
    for (let k = 0; k < chunk.length; k++) {
      const p = chunk[k];
      const base = k * 3;
      valueClauses.push(`($${base+1}, $${base+2}, $${base+3})`);
      params.push(p.name, p.fide_id || null, p.title || null);
    }
    const query = `
      INSERT INTO players (name, fide_id, title)
      VALUES ${valueClauses.join(", ")}
      ON CONFLICT (fide_id) WHERE fide_id IS NOT NULL DO UPDATE SET
        name = CASE WHEN players.name = EXCLUDED.name THEN players.name ELSE EXCLUDED.name END
      RETURNING id, name, fide_id`;
    try {
      const rows = await sql.query(query, params);
      for (const r of rows.rows || rows) {
        if (r.fide_id) fideToId.set(r.fide_id, r.id);
        nameToId.set(r.name.toLowerCase().trim(), r.id);
      }
    } catch (e) {
      console.error(`  Player insert error: ${e.message.substring(0, 120)}`);
    }
  }
}

// Collect all PGN files from all sources
function collectAllFiles() {
  const files = [];

  const mentorDir = path.join(__dirname, "..", "data", "pgnmentor");
  if (fs.existsSync(mentorDir)) {
    const mentorFiles = fs.readdirSync(mentorDir).filter(f => f.endsWith(".pgn")).sort();
    for (const f of mentorFiles) files.push({ source: "PGN Mentor", path: path.join(mentorDir, f) });
  }

  const twicDir = path.join(__dirname, "..", "data", "pgn");
  if (fs.existsSync(twicDir)) {
    const twicFiles = fs.readdirSync(twicDir).filter(f => f.endsWith(".pgn")).sort();
    for (const f of twicFiles) files.push({ source: "TWIC", path: path.join(twicDir, f) });
  }

  const lumbraDir = path.join(__dirname, "..", "data", "lumbrasgigabase");
  if (fs.existsSync(lumbraDir)) {
    function findPgns(dir) {
      const results = [];
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) results.push(...findPgns(full));
        else if (entry.endsWith(".pgn")) results.push(full);
      }
      return results;
    }
    const lumbraFiles = findPgns(lumbraDir).sort();
    for (const f of lumbraFiles) files.push({ source: "Lumbra", path: f });
  }

  return files;
}

async function main() {
  if (!DB_URL) { console.error("No DATABASE_URL"); process.exit(1); }
  const sql = neon(DB_URL);

  const allFiles = collectAllFiles();
  const sourceGroups = {};
  for (const f of allFiles) sourceGroups[f.source] = (sourceGroups[f.source] || 0) + 1;
  console.log("=== Chess Distance — batch-pairs ===");
  for (const [src, count] of Object.entries(sourceGroups)) {
    console.log(`  ${src}: ${count} file(s)`);
  }
  console.log(`  Total: ${allFiles.length} PGN files\n`);

  // Load all existing players from DB into ID maps
  console.log("=== Loading players from DB ===");
  const allPlayers = await sql`SELECT id, name, fide_id FROM players`;
  const fideToId = new Map();
  const nameToId = new Map();
  for (const p of allPlayers) {
    if (p.fide_id) fideToId.set(p.fide_id, p.id);
    nameToId.set(p.name.toLowerCase().trim(), p.id);
  }
  console.log(`  Loaded ${allPlayers.length.toLocaleString()} players\n`);

  function resolveKey(key) {
    if (key.startsWith("fide:")) return fideToId.get(parseInt(key.substring(5))) || null;
    return nameToId.get(key.substring(5)) || null;
  }

  // TRUNCATE once at the start
  console.log("=== Truncating opponents table ===");
  await sql`TRUNCATE opponents`;
  console.log("  Done\n");

  // Process files one-by-one: parse → upsert → free memory
  console.log("=== Parsing and upserting (file by file) ===");
  let totalGames = 0;
  let totalPairsInserted = 0;
  let fileNum = 0;
  let lastSource = null;

  for (const file of allFiles) {
    fileNum++;
    if (file.source !== lastSource) {
      console.log(`\n  [${file.source}]`);
      lastSource = file.source;
    }

    const sizeMB = (fs.statSync(file.path).size / 1024 / 1024).toFixed(0);
    const label = path.basename(file.path);
    process.stdout.write(`    (${fileNum}/${allFiles.length}) ${label} (${sizeMB} MB)... `);
    const t0 = Date.now();

    // Per-file in-memory state (freed after each file)
    const newPlayers = new Map();
    const pairCounts = new Map();
    let fileGames = 0;

    await streamPgn(file.path, (g) => {
      fileGames++;
      totalGames++;
      const wFide = g.WhiteFideId ? parseInt(g.WhiteFideId) || null : null;
      const bFide = g.BlackFideId ? parseInt(g.BlackFideId) || null : null;
      const wName = normalizeName(g.White);
      const bName = normalizeName(g.Black);
      const wKey = wFide ? `fide:${wFide}` : `name:${wName.toLowerCase()}`;
      const bKey = bFide ? `fide:${bFide}` : `name:${bName.toLowerCase()}`;

      // Track new players not in DB
      if (!resolveKey(wKey) && !newPlayers.has(wKey))
        newPlayers.set(wKey, { name: wName, fide_id: wFide, title: g.WhiteTitle || null });
      if (!resolveKey(bKey) && !newPlayers.has(bKey))
        newPlayers.set(bKey, { name: bName, fide_id: bFide, title: g.BlackTitle || null });

      if (wKey === bKey) return;
      const pk = wKey < bKey ? `${wKey}||${bKey}` : `${bKey}||${wKey}`;
      const date = normalizeDate(g.Date);
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
    });

    // Insert new players and update ID maps
    if (newPlayers.size > 0) {
      await insertNewPlayers(sql, newPlayers, fideToId, nameToId);
    }

    // Resolve pairs to DB IDs
    const resolvedPairs = [];
    let skipped = 0;
    for (const [pk, data] of pairCounts) {
      const [keyA, keyB] = pk.split("||");
      const idA = resolveKey(keyA);
      const idB = resolveKey(keyB);
      if (!idA || !idB) { skipped++; continue; }
      const [sId, bId] = idA < idB ? [idA, idB] : [idB, idA];
      resolvedPairs.push({
        a: sId, b: bId, count: data.count, first: data.first, last: data.last,
        classical: data.classical || 0, rapid: data.rapid || 0, blitz: data.blitz || 0,
        event: data.event || null,
      });
    }

    // Upsert to DB
    const inserted = await upsertPairs(sql, resolvedPairs);
    totalPairsInserted += inserted;

    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`${fileGames.toLocaleString()} games, ${inserted.toLocaleString()} pairs (${secs}s)${skipped ? ` [${skipped} skipped]` : ""}`);

    // pairCounts, newPlayers go out of scope here → eligible for GC
  }

  const finalCount = await sql`SELECT COUNT(*) FROM opponents`;
  console.log(`\n=== DONE ===`);
  console.log(`  Total games parsed:     ${totalGames.toLocaleString()}`);
  console.log(`  Total pairs upserted:   ${totalPairsInserted.toLocaleString()}`);
  console.log(`  Opponent pairs in DB:   ${parseInt(finalCount[0].count).toLocaleString()}`);
}

main().catch(console.error);
