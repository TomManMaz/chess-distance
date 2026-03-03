#!/usr/bin/env node
/**
 * Download OTB PGN files from Lumbra's Gigabase (https://lumbrasgigabase.com)
 * Files are hosted on Mega.nz and require megatools to download.
 *
 * Install megatools: sudo apt install megatools
 * (provides the 'megatools' binary with 'dl' subcommand, or 'megadl' on older versions)
 *
 * Usage:
 *   node scripts/download-lumbrasgigabase.js              # download all OTB files
 *   node scripts/download-lumbrasgigabase.js --since 1990 # files from 1990 onwards
 *   node scripts/download-lumbrasgigabase.js --list       # print file list and exit
 */

const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const IS_WINDOWS = os.platform() === "win32";

const DATA_DIR = path.join(__dirname, "..", "data", "lumbrasgigabase");

// All OTB files from Lumbra's Gigabase (last updated 2026-02-08)
const OTB_FILES = [
  {
    name: "otb-0001-1899",
    label: "OTB 0001–1899",
    megaUrl: "https://mega.nz/file/o9IAzaxR#hq4AlER3E-gNADRCEnDsbqTmMtyMKHzkgAML7eSONg4",
    sizeMB: 2.5,
    yearFrom: 1,
    yearTo: 1899,
  },
  {
    name: "otb-1900-1949",
    label: "OTB 1900–1949",
    megaUrl: "https://mega.nz/file/kk4z1KoJ#cLrst5uIc7qBxNJ2dAkZRSLiOlWkJxV_qW62HGUvDb0",
    sizeMB: 11.8,
    yearFrom: 1900,
    yearTo: 1949,
  },
  {
    name: "otb-1950-1969",
    label: "OTB 1950–1969",
    megaUrl: "https://mega.nz/file/hxwSwArR#F1P96hmf7RCvb7Wh1QfVLKpme0QuoQr1HQP3dcX8uME",
    sizeMB: 24.7,
    yearFrom: 1950,
    yearTo: 1969,
  },
  {
    name: "otb-1970-1989",
    label: "OTB 1970–1989",
    megaUrl: "https://mega.nz/file/AxQQ2LZZ#DeJcl_SDRlJk0z3cPLbF3ZR6XVV__oZRYIV65VpLlVY",
    sizeMB: 84.6,
    yearFrom: 1970,
    yearTo: 1989,
  },
  {
    name: "otb-1990-1999",
    label: "OTB 1990–1999",
    megaUrl: "https://mega.nz/file/gpBSnJgC#V2zaqvxB-jci2l6lQIPBXlSwckbTQkUkfQDhqNdrGfw",
    sizeMB: 233,
    yearFrom: 1990,
    yearTo: 1999,
  },
  {
    name: "otb-2000-2004",
    label: "OTB 2000–2004",
    megaUrl: "https://mega.nz/file/Ikw3jYAY#AQkComnIYckn0nB4Xwpn85aW8f8N4-fmREBshjiHa2w",
    sizeMB: 191.4,
    yearFrom: 2000,
    yearTo: 2004,
  },
  {
    name: "otb-2005-2009",
    label: "OTB 2005–2009",
    megaUrl: "https://mega.nz/file/coIg1IAQ#1KWaay1WN6JN7ExBoy7psDd1m1YcBsTUukpw-ohWegI",
    sizeMB: 218.9,
    yearFrom: 2005,
    yearTo: 2009,
  },
  {
    name: "otb-2010-2014",
    label: "OTB 2010–2014",
    megaUrl: "https://mega.nz/file/VhYS1IQL#kQlE330U_38V_XpTHvTSONhqkUndtHqsRnvjrp0DZjQ",
    sizeMB: 262.4,
    yearFrom: 2010,
    yearTo: 2014,
  },
  {
    name: "otb-2015-2019",
    label: "OTB 2015–2019",
    megaUrl: "https://mega.nz/file/F0RDDYxL#RcPYyRqghdkat1SL7tCAyaLauUyr-NBd6NlemJwu23Y",
    sizeMB: 249.2,
    yearFrom: 2015,
    yearTo: 2019,
  },
  {
    name: "otb-2020-2024",
    label: "OTB 2020–2024",
    megaUrl: "https://mega.nz/file/I94FiIBJ#E27wwOg_TAV7foCc-UFsz1SwL5Jg6EksFaUlF54Pavc",
    sizeMB: 143.3,
    yearFrom: 2020,
    yearTo: 2024,
  },
  {
    name: "otb-2025",
    label: "OTB 2025 (Jan–Jun)",
    megaUrl: "https://mega.nz/file/k8gQnDDY#SgV7W9lBzwFCurv5jhwzD5xm1GlXX6db0Pjxi7Zhnrs",
    sizeMB: 33.8,
    yearFrom: 2025,
    yearTo: 2025,
  },
  {
    name: "otb-2026-partial",
    label: "OTB 2026 (partial, Jan–Feb)",
    megaUrl: "https://mega.nz/file/AwYDCb6Q#xqiOEbhDAF_QDCd9rKx6aPtKDAKFfv9ZcZ5YEUPgX3s",
    sizeMB: 8.8,
    yearFrom: 2026,
    yearTo: 2026,
  },
  {
    name: "otb-nodate",
    label: "OTB no-date",
    megaUrl: "https://mega.nz/file/pxQViY7C#xaAzNRETDgro-vVt2NDqiLNYUo4aOfNjwpkNP_BjTCU",
    sizeMB: 0.756,
    yearFrom: null,
    yearTo: null,
  },
];

// Detect which megatools command is available (Linux/Mac only)
function getMegaCmd() {
  if (IS_WINDOWS) return null;
  for (const cmd of ["megatools dl", "megadl"]) {
    const bin = cmd.split(" ")[0];
    const r = spawnSync("which", [bin], { encoding: "utf8" });
    if (r.status === 0) return cmd;
  }
  return null;
}

// Find the 7z binary (cross-platform)
function get7zCmd() {
  if (IS_WINDOWS) {
    const candidates = [
      "C:\\Program Files\\7-Zip\\7z.exe",
      "C:\\Program Files (x86)\\7-Zip\\7z.exe",
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return "7z"; // hope it's on PATH
  }
  return "7z";
}

function hasPgns(dir) {
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some((f) => f.endsWith(".pgn"));
}

function downloadAndExtract(file, megaCmd) {
  const extractDir = path.join(DATA_DIR, file.name);
  const archivePath = path.join(DATA_DIR, `${file.name}.7z`);
  const tmpDir = path.join(DATA_DIR, `_tmp_${file.name}`);

  // Already extracted?
  if (hasPgns(extractDir)) {
    const count = fs.readdirSync(extractDir).filter((f) => f.endsWith(".pgn")).length;
    console.log(`  Skipping ${file.label} — already extracted (${count} PGN file(s))`);
    return extractDir;
  }

  // Download if archive not present
  if (!fs.existsSync(archivePath)) {
    console.log(`  Downloading ${file.label} (~${file.sizeMB} MB)...`);

    // Download to a temp dir so we can identify the downloaded filename
    fs.mkdirSync(tmpDir, { recursive: true });

    const [megaBin, ...megaArgs] = megaCmd.split(" ");
    const dlArgs = [...megaArgs, "--path", tmpDir, file.megaUrl];
    const result = spawnSync(megaBin, dlArgs, { stdio: "inherit" });

    if (result.status !== 0) {
      console.error(`  ERROR: Download failed for ${file.label}`);
      return null;
    }

    // Find the downloaded .7z file in tmpDir
    const downloaded = fs.readdirSync(tmpDir).find((f) => f.endsWith(".7z"));
    if (!downloaded) {
      console.error(`  ERROR: No .7z file found after download in ${tmpDir}`);
      return null;
    }

    fs.renameSync(path.join(tmpDir, downloaded), archivePath);
    fs.rmdirSync(tmpDir);
    console.log(`  Saved as: ${path.basename(archivePath)}`);
  } else {
    console.log(`  Archive exists: ${path.basename(archivePath)}`);
  }

  // Extract
  console.log(`  Extracting...`);
  fs.mkdirSync(extractDir, { recursive: true });
  const sevenZ = get7zCmd();
  const result = spawnSync(sevenZ, ["x", archivePath, `-o${extractDir}`, "-y"], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error(`  ERROR: Extraction failed for ${path.basename(archivePath)}`);
    return null;
  }

  const pgns = fs.readdirSync(extractDir).filter((f) => f.endsWith(".pgn")).length;
  console.log(`  Extracted ${pgns} PGN file(s) to ${extractDir}`);
  return extractDir;
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--list")) {
    console.log("Available OTB files from Lumbra's Gigabase:");
    let total = 0;
    for (const f of OTB_FILES) {
      const range = f.yearFrom ? `${f.yearFrom}–${f.yearTo ?? "?"}` : "no date";
      console.log(`  ${f.label.padEnd(30)} ${String(f.sizeMB).padStart(7)} MB  ${f.megaUrl}`);
      total += f.sizeMB;
    }
    console.log(`\n  Total compressed: ~${total.toFixed(0)} MB (~${(total * 5).toFixed(0)} MB uncompressed)`);
    return;
  }

  const megaCmd = getMegaCmd();
  if (!megaCmd) {
    if (IS_WINDOWS) {
      console.error("ERROR: megatools is not available on Windows.");
      console.error("Options:");
      console.error("  1. Run this script on Linux/Mac (WSL works fine on Windows)");
      console.error("  2. Download the files manually from the Mega.nz links (use --list to see them)");
      console.error("     Then extract the .7z archives to data/lumbrasgigabase/<name>/");
    } else {
      console.error("ERROR: megatools not found. Install with:");
      console.error("  sudo apt install megatools   (Debian/Ubuntu)");
      console.error("  brew install megatools       (macOS)");
    }
    process.exit(1);
  }
  console.log(`Using: ${megaCmd}`);

  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Filter by --since YEAR
  const sinceIdx = args.indexOf("--since");
  const sinceYear = sinceIdx >= 0 ? parseInt(args[sinceIdx + 1]) : null;

  let filesToDownload = OTB_FILES;
  if (sinceYear) {
    filesToDownload = OTB_FILES.filter(
      (f) => f.yearTo === null || f.yearTo >= sinceYear || f.yearFrom === null
    );
    console.log(`Filtering: only files with data from ${sinceYear} onwards\n`);
  }

  const totalMB = filesToDownload.reduce((s, f) => s + f.sizeMB, 0);
  console.log(`Lumbra's Gigabase OTB Downloader`);
  console.log(`Files to download: ${filesToDownload.length}  (~${totalMB.toFixed(0)} MB compressed)`);
  console.log(`Output: ${DATA_DIR}\n`);

  const done = [];
  const failed = [];

  for (const file of filesToDownload) {
    console.log(`\n[${file.label}]`);
    const dir = downloadAndExtract(file, megaCmd);
    if (dir) done.push(file.name);
    else failed.push(file.name);
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Done: ${done.length} file(s)`);
  if (failed.length) console.log(`Failed: ${failed.join(", ")}`);
  console.log(`\nNext steps:`);
  console.log(`  DATABASE_URL=... node scripts/batch-pairs.js`);
  console.log(`  DATABASE_URL=... node scripts/cleanup-data.js`);
  console.log(`  DATABASE_URL=... node scripts/validate-data.js --fix`);
}

main();
