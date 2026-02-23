/**
 * download-fide-xml.js
 *
 * Downloads the FIDE standard rating list XML and upserts all rated players
 * into the `players` table by fide_id. Safe to run multiple times.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/download-fide-xml.js
 *   DATABASE_URL=... node scripts/download-fide-xml.js --no-download   # skip download, re-parse existing file
 */

const https = require("https");
const http  = require("http");
const fs    = require("fs");
const path  = require("path");
const readline = require("readline");
const { execSync } = require("child_process");
const { neon } = require("@neondatabase/serverless");

const DB_URL      = process.env.DATABASE_URL;
const DATA_DIR    = path.join(__dirname, "..", "data");
const ZIP_PATH    = path.join(DATA_DIR, "fide_standard.zip");
const EXTRACT_DIR = path.join(DATA_DIR, "fide");
const FIDE_URL    = "https://ratings.fide.com/download/standard_rating_list_xml.zip";
const BATCH_SIZE  = 500;
const NO_DOWNLOAD = process.argv.includes("--no-download");

// ---------------------------------------------------------------------------
// Download with redirect support
// ---------------------------------------------------------------------------
function download(urlStr, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("Too many redirects"));
    const parsed = new URL(urlStr);
    const getter = parsed.protocol === "https:" ? https : http;
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; chess-distance-etl)" },
    };
    const file = fs.createWriteStream(dest);
    getter.get(options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.existsSync(dest) && fs.unlinkSync(dest);
        const loc = res.headers.location;
        const next = loc.startsWith("http") ? loc : `${parsed.protocol}//${parsed.hostname}${loc}`;
        return download(next, dest, redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const total = parseInt(res.headers["content-length"] || "0");
      let received = 0;
      res.on("data", (chunk) => {
        received += chunk.length;
        if (total) {
          const pct = Math.round((received / total) * 100);
          process.stdout.write(`\r  ${pct}% (${(received / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB)`);
        }
      });
      res.pipe(file);
      file.on("finish", () => { file.close(); console.log(""); resolve(); });
      file.on("error", reject);
    }).on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Unzip (works on Linux with `unzip` or Windows/WSL with PowerShell)
// ---------------------------------------------------------------------------
function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  try {
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: "pipe" });
  } catch {
    const zpw = zipPath.replace(/\//g, "\\");
    const ddw = destDir.replace(/\//g, "\\");
    execSync(
      `powershell.exe -Command "Expand-Archive -Path '${zpw}' -DestinationPath '${ddw}' -Force"`,
      { stdio: "pipe", timeout: 120000 }
    );
  }
}

function findXmlFile(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".xml"));
  if (!files.length) throw new Error("No XML file found in " + dir);
  // Prefer the standard (not rapid/blitz) file
  const standard = files.find(f => f.toLowerCase().includes("standard")) || files[0];
  return path.join(dir, standard);
}

// ---------------------------------------------------------------------------
// Stream-parse the FIDE XML line by line
// ---------------------------------------------------------------------------
async function parseXml(xmlPath) {
  const rl = readline.createInterface({
    input: fs.createReadStream(xmlPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  const players = [];
  let cur = {};
  let inPlayer = false;

  for await (const line of rl) {
    const t = line.trim();
    if (t === "<player>") {
      cur = {};
      inPlayer = true;
    } else if (t === "</player>" && inPlayer) {
      if (cur.fideid && cur.name) players.push(cur);
      if (players.length % 50000 === 0 && players.length > 0) {
        process.stdout.write(`\r  Parsed ${players.length.toLocaleString()} players...`);
      }
      inPlayer = false;
    } else if (inPlayer) {
      // Tags are on their own lines: <tagname>value</tagname>
      const m = t.match(/^<([a-z_]+)>(.*?)<\/\1>$/);
      if (m) cur[m[1]] = m[2];
    }
  }

  process.stdout.write(`\r  Parsed ${players.length.toLocaleString()} players     \n`);
  return players;
}

// ---------------------------------------------------------------------------
// Batch-upsert players into DB
// ---------------------------------------------------------------------------
async function upsertPlayers(players, sql) {
  let done = 0;
  const total = players.length;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const chunk = players.slice(i, i + BATCH_SIZE);
    const params  = [];
    const clauses = [];

    for (let k = 0; k < chunk.length; k++) {
      const p = chunk[k];
      const fideId = parseInt(p.fideid);
      if (!fideId || !p.name) continue;
      // Prefer OTB title, fall back to women's title
      const title = (p.title && p.title.trim()) || (p.w_title && p.w_title.trim()) || null;
      const base = k * 4;
      clauses.push(`($${base + 1}::integer, $${base + 2}, $${base + 3}, $${base + 4})`);
      params.push(fideId, p.name.trim(), p.country || null, title || null);
    }

    if (!clauses.length) continue;

    await sql.query(
      `INSERT INTO players (fide_id, name, federation, title)
       VALUES ${clauses.join(", ")}
       ON CONFLICT (fide_id) DO UPDATE SET
         name       = EXCLUDED.name,
         federation = EXCLUDED.federation,
         title      = COALESCE(EXCLUDED.title, players.title)`,
      params
    );

    done += chunk.length;
    const pct = Math.round((done / total) * 100);
    process.stdout.write(`\r  Upserted ${done.toLocaleString()} / ${total.toLocaleString()} (${pct}%)`);
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!DB_URL) { console.error("No DATABASE_URL"); process.exit(1); }
  const sql = neon(DB_URL);

  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Step 1: Download
  if (NO_DOWNLOAD) {
    console.log("=== Step 1: Skipping download (--no-download) ===");
  } else {
    console.log("=== Step 1: Downloading FIDE standard rating list XML ===");
    if (fs.existsSync(ZIP_PATH)) {
      console.log("  ZIP already exists. Delete data/fide_standard.zip to re-download.");
    } else {
      await download(FIDE_URL, ZIP_PATH);
      console.log(`  Saved to ${ZIP_PATH}`);
    }
  }

  // Step 2: Extract
  console.log("\n=== Step 2: Extracting XML ===");
  extractZip(ZIP_PATH, EXTRACT_DIR);
  const xmlPath = findXmlFile(EXTRACT_DIR);
  console.log(`  ${path.basename(xmlPath)}`);

  // Step 3: Parse
  console.log("\n=== Step 3: Parsing XML ===");
  const players = await parseXml(xmlPath);

  // Step 4: Upsert
  console.log("\n=== Step 4: Upserting into database ===");
  const before = await sql`SELECT count(*) AS n FROM players`;
  await upsertPlayers(players, sql);
  const after = await sql`SELECT count(*) AS n FROM players`;

  console.log(`\n=== Done ===`);
  console.log(`  FIDE players processed: ${players.length.toLocaleString()}`);
  console.log(`  DB players before: ${before[0].n}`);
  console.log(`  DB players after:  ${after[0].n} (+${after[0].n - before[0].n} new)`);
  console.log(`\nNext step: node scripts/batch-pairs.js`);
}

main().catch(console.error);
