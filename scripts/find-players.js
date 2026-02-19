const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ZIP_DIR = path.join(__dirname, "..", "data", "pgn-zips");
const PGN_DIR = path.join(__dirname, "..", "data", "pgn");

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

async function main() {
  fs.mkdirSync(ZIP_DIR, { recursive: true });
  fs.mkdirSync(PGN_DIR, { recursive: true });

  const targets = process.argv.slice(2, -3).length > 0
    ? process.argv.slice(2, -3)
    : ["mannelli", "david, sophie"];
  const args = process.argv.slice(-3);
  const start = parseInt(args[0] || "920");
  const end = parseInt(args[1] || "1560");
  const step = parseInt(args[2] || "10");

  console.log(`Searching for: ${targets.join(" | ")} in TWIC ${start}-${end} (step ${step})`);

  for (let i = start; i <= end; i += step) {
    const zipName = `twic${i}g.zip`;
    const zipPath = path.join(ZIP_DIR, zipName);
    const url = `https://theweekinchess.com/zips/${zipName}`;

    try {
      if (!fs.existsSync(zipPath)) {
        await download(url, zipPath);
      }
      const zpw = zipPath.replace(/\//g, "\\");
      const pdw = PGN_DIR.replace(/\//g, "\\");
      execSync(
        `powershell.exe -Command "Expand-Archive -Path '${zpw}' -DestinationPath '${pdw}' -Force"`,
        { stdio: "pipe" }
      );
      const pgnFile = path.join(PGN_DIR, `twic${i}.pgn`);
      if (fs.existsSync(pgnFile)) {
        const c = fs.readFileSync(pgnFile, "utf-8").toLowerCase();
        for (const t of targets) {
          if (c.includes(t.toLowerCase())) {
            console.log(`FOUND "${t}" in TWIC ${i}`);
          }
        }
      }
    } catch (e) {
      // skip
    }
  }
  console.log("Search done");
}

main();
