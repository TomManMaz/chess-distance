/**
 * download-twic.js
 *
 * Downloads TWIC (The Week in Chess) PGN zip files not yet present in
 * data/pgn/ and extracts them. Auto-detects the starting issue from
 * existing files.
 *
 * Usage:
 *   node scripts/download-twic.js
 *   node scripts/download-twic.js --start=1090   # force a specific start issue
 *
 * After downloading, run:
 *   node scripts/batch-pairs.js
 */

const https = require("https");
const http  = require("http");
const fs    = require("fs");
const path  = require("path");
const { execSync } = require("child_process");

const DATA_DIR   = path.join(__dirname, "..", "data", "pgn");
const UA         = "Mozilla/5.0 (compatible; chess-distance-etl)";
const DELAY_MS   = 250;  // polite pause between requests
const MAX_CONSECUTIVE_404 = 3;

// Parse optional --start=NNNN argument
const startArg   = process.argv.find(a => a.startsWith("--start="));
const FORCE_START = startArg ? parseInt(startArg.split("=")[1]) : null;

// ---------------------------------------------------------------------------
// Find highest TWIC issue already in data/pgn/
// ---------------------------------------------------------------------------
function getExistingIssues() {
  if (!fs.existsSync(DATA_DIR)) return new Set();
  const issues = new Set();
  for (const f of fs.readdirSync(DATA_DIR)) {
    const m = f.match(/^twic(\d+)\.pgn$/i);
    if (m) issues.add(parseInt(m[1]));
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Download a single TWIC zip. Returns dest path on success, null on 404.
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
          return resolve(null); // signals "not available"
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

// ---------------------------------------------------------------------------
// Extract a zip file (Linux unzip or PowerShell fallback)
// ---------------------------------------------------------------------------
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
  fs.unlinkSync(zipPath); // remove zip after successful extraction
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const existing   = getExistingIssues();
  const maxExisting = existing.size > 0 ? Math.max(...existing) : 919;
  const startFrom  = FORCE_START ?? (maxExisting + 1);

  console.log("=== TWIC Downloader ===");
  console.log(`  Existing PGN files in data/pgn/: ${existing.size} (highest: ${maxExisting})`);
  console.log(`  Downloading from issue ${startFrom} onwards`);
  console.log(`  (Stops after ${MAX_CONSECUTIVE_404} consecutive 404s)`);
  console.log("");

  let downloaded = 0;
  let skipped    = 0;
  let errors     = 0;
  let consecutive404 = 0;

  for (let issue = startFrom; ; issue++) {
    if (existing.has(issue)) {
      skipped++;
      continue;
    }

    process.stdout.write(`\r  Issue ${issue}: downloading...             `);

    try {
      const result = await downloadIssue(issue);

      if (result === null) {
        consecutive404++;
        process.stdout.write(`\r  Issue ${issue}: not found (404)          \n`);
        if (consecutive404 >= MAX_CONSECUTIVE_404) {
          console.log(`  ${MAX_CONSECUTIVE_404} consecutive 404s — reached end of archive.`);
          break;
        }
        continue;
      }

      consecutive404 = 0;

      process.stdout.write(`\r  Issue ${issue}: extracting...             `);
      extractZip(result);

      downloaded++;
      process.stdout.write(`\r  Issue ${issue}: ✓ (${downloaded} downloaded)          \n`);

      await sleep(DELAY_MS);
    } catch (e) {
      errors++;
      process.stdout.write(`\r  Issue ${issue}: ERROR — ${String(e.message).substring(0, 60)}\n`);
    }
  }

  const total = existing.size + downloaded;
  console.log(`\n=== Done ===`);
  console.log(`  Downloaded this run:    ${downloaded}`);
  console.log(`  Skipped (already had):  ${skipped}`);
  console.log(`  Errors:                 ${errors}`);
  console.log(`  Total PGN files now:    ${total}`);
  console.log(`\nNext step:`);
  console.log(`  node scripts/batch-pairs.js`);
}

main().catch(console.error);
