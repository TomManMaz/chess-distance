/**
 * update-twic.js
 *
 * Incremental TWIC updater: downloads new TWIC issues not yet loaded into
 * the database, parses them, and upserts players + opponent pairs.
 *
 * Unlike batch-pairs.js, this never TRUNCATEs — it uses ON CONFLICT to
 * merge new data into existing rows. A `settings` table tracks the last
 * processed TWIC issue number.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/update-twic.js
 *   DATABASE_URL=... node scripts/update-twic.js --dry-run
 *
 * Environment:
 *   DATABASE_URL  — Neon PostgreSQL connection string (required)
 */

const https = require("https");
const http  = require("http");
const fs    = require("fs");
const path  = require("path");
const { execSync } = require("child_process");
const postgres = require("postgres");

const DATA_DIR = path.join(__dirname, "..", "data", "pgn");
const UA = "Mozilla/5.0 (compatible; chess-distance-etl)";
const DELAY_MS = 300;
const MAX_CONSECUTIVE_404 = 3;
const BATCH_SIZE = 200;
const CONC = 10;
const DEFAULT_LAST_ISSUE = 1633;

const DB_URL = process.env.DATABASE_URL;
const DRY_RUN = process.argv.includes("--dry-run");

if (!DB_URL) { console.error("No DATABASE_URL"); process.exit(1); }
const sql = postgres(DB_URL, { max: 1 });

// ---------------------------------------------------------------------------
// PGN parsing helpers (same as batch-pairs.js)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Download helpers (same as download-twic.js)
// ---------------------------------------------------------------------------
function downloadIssue(issueNum) {
  const url  = `https://theweekinchess.com/zips/twic${issueNum}g.zip`;
  const dest = path.join(DATA_DIR, `twic${issueNum}g.zip`);

  return new Promise((resolve, reject) => {
    function tryGet(urlStr, redirects = 0) {
      if (redirects > 5) return reject(new Error("Too many redirects"));
      const parsed = new URL(urlStr);
      const getter = parsed.protocol === "https:" ? https : http;
      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: { "User-Agent": UA },
      };
      getter.get(options, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume();
          const loc = res.headers.location;
          const next = loc.startsWith("http") ? loc : `${parsed.protocol}//${parsed.hostname}${loc}`;
          return tryGet(next, redirects + 1);
        }
        if (res.statusCode === 404 || res.statusCode === 403) {
          res.resume();
          return resolve(null);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(dest); });
        file.on("error", reject);
      }).on("error", reject);
    }
    tryGet(url);
  });
}

function extractZip(zipPath) {
  const dir = path.dirname(zipPath);
  try {
    execSync(`unzip -o "${zipPath}" -d "${dir}"`, { stdio: "pipe" });
  } catch {
    const zpw = zipPath.replace(/\//g, "\\");
    const ddw = dir.replace(/\//g, "\\");
    execSync(
      `powershell.exe -Command "Expand-Archive -Path '${zpw}' -DestinationPath '${ddw}' -Force"`,
      { stdio: "pipe", timeout: 60000 }
    );
  }
  fs.unlinkSync(zipPath);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Settings table helpers
// ---------------------------------------------------------------------------
async function ensureSettingsTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `;
}

async function getSetting(key, defaultValue) {
  const rows = await sql`SELECT value FROM settings WHERE key = ${key}`;
  return rows.length > 0 ? rows[0].value : defaultValue;
}

async function setSetting(key, value) {
  await sql`
    INSERT INTO settings (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (DRY_RUN) console.log("*** DRY-RUN MODE ***\n");

  // 1. Ensure settings table exists and read last processed issue
  await ensureSettingsTable();
  const lastIssueStr = await getSetting("last_twic_issue", String(DEFAULT_LAST_ISSUE));
  const lastIssue = parseInt(lastIssueStr);
  const startFrom = lastIssue + 1;

  console.log(`=== Incremental TWIC Updater ===`);
  console.log(`  Last processed issue: ${lastIssue}`);
  console.log(`  Downloading from:     ${startFrom}`);
  console.log("");

  // 2. Download new TWIC issues
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const downloadedIssues = [];
  let consecutive404 = 0;

  for (let issue = startFrom; ; issue++) {
    process.stdout.write(`\r  Issue ${issue}: downloading...            `);

    try {
      const zipPath = await downloadIssue(issue);

      if (zipPath === null) {
        consecutive404++;
        process.stdout.write(`\r  Issue ${issue}: not found (404)         \n`);
        if (consecutive404 >= MAX_CONSECUTIVE_404) {
          console.log(`  ${MAX_CONSECUTIVE_404} consecutive 404s — reached end of archive.`);
          break;
        }
        continue;
      }

      consecutive404 = 0;
      process.stdout.write(`\r  Issue ${issue}: extracting...            `);
      extractZip(zipPath);

      // Zip extracts to twic${N}g.pgn; fall back to twic${N}.pgn if needed
      let pgnPath = path.join(DATA_DIR, `twic${issue}g.pgn`);
      if (!fs.existsSync(pgnPath)) {
        pgnPath = path.join(DATA_DIR, `twic${issue}.pgn`);
      }

      if (fs.existsSync(pgnPath)) {
        downloadedIssues.push({ issue, pgnPath });
        process.stdout.write(`\r  Issue ${issue}: ok (${downloadedIssues.length} downloaded)        \n`);
      } else {
        process.stdout.write(`\r  Issue ${issue}: extracted but no PGN found\n`);
      }

      await sleep(DELAY_MS);
    } catch (e) {
      process.stdout.write(`\r  Issue ${issue}: ERROR — ${String(e.message).substring(0, 60)}\n`);
    }
  }

  if (downloadedIssues.length === 0) {
    console.log("\nNo new issues found. DB is up to date.");
    return;
  }

  console.log(`\nDownloaded ${downloadedIssues.length} new issue(s). Parsing games...\n`);

  // 3. Parse new PGN files
  const playersByKey = new Map();
  const pairCounts = new Map();
  let totalGames = 0;

  for (const { issue, pgnPath } of downloadedIssues) {
    const games = parsePgn(pgnPath);
    totalGames += games.length;
    console.log(`  Issue ${issue}: ${games.length} games (${path.basename(pgnPath)})`);

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

  console.log(`\n  Total games parsed: ${totalGames}`);
  console.log(`  Unique player keys: ${playersByKey.size}`);
  console.log(`  Unique pairs:       ${pairCounts.size}`);

  if (DRY_RUN) {
    console.log("\n[DRY-RUN] Would upsert players and pairs. Skipping DB writes.");
    for (const { pgnPath } of downloadedIssues) {
      if (fs.existsSync(pgnPath)) fs.unlinkSync(pgnPath);
    }
    return;
  }

  // 4. Load existing player maps from DB
  console.log("\n=== Loading player ID maps from DB ===");
  const allPlayers = await sql`SELECT id, name, fide_id FROM players`;
  console.log(`  ${allPlayers.length} players in DB`);

  const fideToId = new Map();
  const nameToId = new Map();
  for (const p of allPlayers) {
    if (p.fide_id) fideToId.set(p.fide_id, p.id);
    nameToId.set(p.name.toLowerCase().trim(), p.id);
  }

  // 5. Upsert new players not yet in DB
  console.log("\n=== Upserting new players ===");
  const fidePlayers = [];  // FIDE-keyed, not in fideToId yet
  const namePlayers = [];  // name-keyed, not in nameToId yet

  for (const [key, data] of playersByKey) {
    if (key.startsWith("fide:")) {
      const fid = parseInt(key.substring(5));
      if (!fideToId.has(fid)) fidePlayers.push({ fide_id: fid, ...data });
    } else {
      const name = key.substring(5);
      if (!nameToId.has(name)) namePlayers.push(data);
    }
  }

  console.log(`  New FIDE players to upsert: ${fidePlayers.length}`);
  console.log(`  New name-only players:       ${namePlayers.length}`);

  // Upsert FIDE players one by one (small number expected)
  for (const p of fidePlayers) {
    const rows = await sql`
      INSERT INTO players (name, fide_id, title)
      VALUES (${p.name}, ${p.fide_id}, ${p.title || null})
      ON CONFLICT (fide_id) DO UPDATE SET
        title = COALESCE(players.title, EXCLUDED.title)
      RETURNING id, fide_id
    `;
    if (rows.length > 0) fideToId.set(rows[0].fide_id, rows[0].id);
  }

  // Insert name-only players that don't exist yet
  for (const p of namePlayers) {
    const normName = p.name.toLowerCase().trim();
    if (nameToId.has(normName)) continue;
    const rows = await sql`
      INSERT INTO players (name, title)
      SELECT ${p.name}, ${p.title || null}
      WHERE NOT EXISTS (SELECT 1 FROM players WHERE LOWER(TRIM(name)) = ${normName})
      RETURNING id, name
    `;
    if (rows.length > 0) nameToId.set(normName, rows[0].id);
  }

  // 6. Resolve pairs and batch-upsert
  console.log("\n=== Upserting opponent pairs ===");

  function resolveKey(key) {
    if (key.startsWith("fide:")) {
      const fid = parseInt(key.substring(5));
      return fideToId.get(fid) || null;
    } else {
      const name = key.substring(5);
      return nameToId.get(name) || null;
    }
  }

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

  console.log(`  Resolved ${resolvedPairs.length} pairs (skipped ${skipped} with missing players)`);

  let upserted = 0;
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
        valueClauses.push(`($${base+1}, $${base+2}, $${base+3}, $${base+4}::date, $${base+5}::date, $${base+6}, $${base+7}, $${base+8}, $${base+9})`);
        params.push(p.a, p.b, p.count, p.first, p.last, p.classical, p.rapid, p.blitz, p.event);
      }

      const query = `
        INSERT INTO opponents (player_a_id, player_b_id, game_count, first_game_date, last_game_date, classical_count, rapid_count, blitz_count, event_sample)
        VALUES ${valueClauses.join(", ")}
        ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET
          game_count      = opponents.game_count + EXCLUDED.game_count,
          first_game_date = LEAST(opponents.first_game_date, EXCLUDED.first_game_date),
          last_game_date  = GREATEST(opponents.last_game_date, EXCLUDED.last_game_date),
          classical_count = opponents.classical_count + EXCLUDED.classical_count,
          rapid_count     = opponents.rapid_count + EXCLUDED.rapid_count,
          blitz_count     = opponents.blitz_count + EXCLUDED.blitz_count,
          event_sample    = COALESCE(opponents.event_sample, EXCLUDED.event_sample)`;

      batchPromises.push(
        sql.unsafe(query, params).then(() => { upserted += chunk.length; }).catch(e => {
          console.error(`\n  Batch error at ${start}: ${e.message.substring(0, 120)}`);
        })
      );
    }

    await Promise.all(batchPromises);

    const pct = Math.round((upserted / resolvedPairs.length) * 100);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    process.stdout.write(`\r  ${pct}% (${upserted}/${resolvedPairs.length}) - ${elapsed}s    `);
  }

  console.log(`\n`);

  // 7. Update last_twic_issue in settings
  const maxIssue = Math.max(...downloadedIssues.map(d => d.issue));
  await setSetting("last_twic_issue", String(maxIssue));
  console.log(`  Updated last_twic_issue → ${maxIssue}`);

  // 8. Clean up downloaded PGN files (saves CI disk space)
  let cleaned = 0;
  for (const { pgnPath } of downloadedIssues) {
    if (fs.existsSync(pgnPath)) {
      fs.unlinkSync(pgnPath);
      cleaned++;
    }
  }
  console.log(`  Cleaned up ${cleaned} PGN file(s)`);

  console.log(`\n=== Done ===`);
  console.log(`  Issues processed: ${downloadedIssues.length}`);
  console.log(`  Games parsed:     ${totalGames}`);
  console.log(`  Pairs upserted:   ${upserted}`);
}

main().catch(console.error);
