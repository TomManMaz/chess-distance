const fs = require("fs");
const path = require("path");
const { neon } = require("@neondatabase/serverless");

const DATA_DIR = path.join(__dirname, "..", "data", "pgnmentor");
const DB_URL = process.env.DATABASE_URL;
const BATCH_SIZE = 200; // rows per INSERT
const CONC = 10; // concurrent batch INSERTs

function parseHeader(line) {
  const m = line.match(/^\[(\w+)\s+"(.*)"\]$/);
  return m ? [m[1], m[2]] : null;
}

function normalizeName(name) {
  return name.replace(/,([^\s])/, ", $1").trim();
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
  if (!DB_URL) { console.error("No DATABASE_URL"); process.exit(1); }
  const sql = neon(DB_URL);

  // Phase 1: Parse all PGN files to build pair data
  console.log("=== Phase 1: Parsing PGN files ===");
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
  }

  // PGN Mentor files
  if (fs.existsSync(DATA_DIR)) {
    const mentorFiles = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".pgn")).sort();
    console.log(`  PGN Mentor: ${mentorFiles.length} files`);
    for (const f of mentorFiles) processFile(path.join(DATA_DIR, f));
  }

  // TWIC files
  const twicDir = path.join(__dirname, "..", "data", "pgn");
  if (fs.existsSync(twicDir)) {
    const twicFiles = fs.readdirSync(twicDir).filter(f => f.endsWith(".pgn")).sort();
    console.log(`  TWIC: ${twicFiles.length} files`);
    for (const f of twicFiles) processFile(path.join(twicDir, f));
  }

  console.log(`  Total games: ${totalGames}`);
  console.log(`  Unique players: ${playersByKey.size}`);
  console.log(`  Unique opponent pairs: ${pairCounts.size}\n`);

  // Phase 2: Get player ID mapping from DB
  console.log("=== Phase 2: Building player ID map ===");
  // Get all players from DB
  const allPlayers = await sql`SELECT id, name, fide_id FROM players`;
  console.log(`  Found ${allPlayers.length} players in DB`);

  // Build lookup maps
  const fideToId = new Map();
  const nameToId = new Map();
  for (const p of allPlayers) {
    if (p.fide_id) fideToId.set(p.fide_id, p.id);
    nameToId.set(p.name.toLowerCase().trim(), p.id);
  }

  function resolveKey(key) {
    if (key.startsWith("fide:")) {
      const fid = parseInt(key.substring(5));
      return fideToId.get(fid) || null;
    } else {
      const name = key.substring(5); // "name:"
      return nameToId.get(name) || null;
    }
  }

  // Phase 3: Batch insert opponent pairs
  console.log("=== Phase 3: Inserting opponent pairs ===");
  // First clear existing pairs
  await sql`TRUNCATE opponents`;
  console.log("  Truncated opponents table");

  const pairs = [...pairCounts.entries()];
  const resolvedPairs = [];
  let skipped = 0;

  for (const [pk, data] of pairs) {
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

  console.log(`  Resolved ${resolvedPairs.length} pairs (skipped ${skipped} with missing players)`);

  let inserted = 0;
  const startTime = Date.now();

  for (let i = 0; i < resolvedPairs.length; i += BATCH_SIZE * CONC) {
    const batchPromises = [];

    for (let j = 0; j < CONC && (i + j * BATCH_SIZE) < resolvedPairs.length; j++) {
      const start = i + j * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, resolvedPairs.length);
      const chunk = resolvedPairs.slice(start, end);

      // Build a multi-row INSERT with parameterized placeholders
      const params = [];
      const valueClauses = [];
      for (let k = 0; k < chunk.length; k++) {
        const p = chunk[k];
        const base = k * 9;
        valueClauses.push(`($${base+1}, $${base+2}, $${base+3}, $${base+4}::date, $${base+5}::date, $${base+6}, $${base+7}, $${base+8}, $${base+9})`);
        params.push(p.a, p.b, p.count, p.first, p.last, p.classical, p.rapid, p.blitz, p.event);
      }

      const query = `
        INSERT INTO opponents (player_a_id, player_b_id, game_count, first_game_date, last_game_date, classical_count, rapid_count, blitz_count, event_sample)
        VALUES ${valueClauses.join(", ")}
        ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET
          game_count = opponents.game_count + EXCLUDED.game_count,
          first_game_date = LEAST(opponents.first_game_date, EXCLUDED.first_game_date),
          last_game_date = GREATEST(opponents.last_game_date, EXCLUDED.last_game_date),
          classical_count = opponents.classical_count + EXCLUDED.classical_count,
          rapid_count = opponents.rapid_count + EXCLUDED.rapid_count,
          blitz_count = opponents.blitz_count + EXCLUDED.blitz_count,
          event_sample = COALESCE(opponents.event_sample, EXCLUDED.event_sample)`;

      batchPromises.push(
        sql.query(query, params).then(() => { inserted += chunk.length; }).catch(e => {
          console.error(`\n  Batch error at ${start}: ${e.message.substring(0, 120)}`);
        })
      );
    }

    await Promise.all(batchPromises);

    const pct = Math.round((inserted / resolvedPairs.length) * 100);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = Math.round(inserted / (elapsed || 1));
    process.stdout.write(`\r  ${pct}% (${inserted}/${resolvedPairs.length}) - ${elapsed}s - ${rate} pairs/s    `);
  }

  console.log(`\n\n=== DONE ===`);
  console.log(`  Players in DB: ${allPlayers.length}`);
  console.log(`  Pairs inserted: ${inserted}`);
  console.log(`  Total games: ${totalGames}`);
}

main().catch(console.error);
