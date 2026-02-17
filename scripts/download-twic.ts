import { mkdirSync, existsSync, createWriteStream } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import https from "https";
import http from "http";

const DATA_DIR = join(__dirname, "..", "data", "pgn-zips");
const EXTRACT_DIR = join(__dirname, "..", "data", "pgn");
const START_ISSUE = 920;
const END_ISSUE = 1600;

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    const file = createWriteStream(dest);
    proto.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          download(redirectUrl, dest).then(resolve).catch(reject);
          return;
        }
      }
      if (response.statusCode !== 200) {
        file.close();
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    }).on("error", (err) => {
      file.close();
      reject(err);
    });
  });
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(EXTRACT_DIR, { recursive: true });

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (let issue = START_ISSUE; issue <= END_ISSUE; issue++) {
    const zipName = `twic${issue}g.zip`;
    const zipPath = join(DATA_DIR, zipName);
    const pgnName = `twic${issue}.pgn`;
    const pgnPath = join(EXTRACT_DIR, pgnName);

    if (existsSync(pgnPath)) {
      skipped++;
      continue;
    }

    const url = `https://theweekinchess.com/zips/${zipName}`;

    try {
      if (!existsSync(zipPath)) {
        process.stdout.write(`Downloading TWIC ${issue}...`);
        await download(url, zipPath);
        process.stdout.write(" done\n");
      }

      // Extract using system unzip or PowerShell
      try {
        execSync(
          `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${EXTRACT_DIR}' -Force"`,
          { stdio: "pipe" }
        );
      } catch {
        execSync(`unzip -o "${zipPath}" -d "${EXTRACT_DIR}"`, {
          stdio: "pipe",
        });
      }

      downloaded++;
    } catch (err) {
      console.error(`Failed TWIC ${issue}: ${err}`);
      failed++;
    }
  }

  console.log(
    `\nDone. Downloaded: ${downloaded}, Skipped: ${skipped}, Failed: ${failed}`
  );
}

main().catch(console.error);
