import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const PGN_DIR = join(__dirname, "..", "data", "pgn");
const OUTPUT_FILE = join(__dirname, "..", "data", "games.jsonl");

interface GameRecord {
  white: string;
  black: string;
  white_elo: number | null;
  black_elo: number | null;
  white_fide_id: number | null;
  black_fide_id: number | null;
  white_title: string | null;
  black_title: string | null;
  event: string | null;
  date: string | null;
  result: string | null;
}

function parseHeader(line: string): [string, string] | null {
  const match = line.match(/^\[(\w+)\s+"(.*)"\]$/);
  if (!match) return null;
  return [match[1], match[2]];
}

function parsePgnFile(filePath: string): GameRecord[] {
  const content = readFileSync(filePath, "utf-8");
  const games: GameRecord[] = [];
  let current: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      const parsed = parseHeader(trimmed);
      if (parsed) {
        current[parsed[0]] = parsed[1];
      }
    } else if (trimmed === "" && current["White"] && current["Black"]) {
      // End of headers block — emit game record
      const white = current["White"];
      const black = current["Black"];

      // Skip entries with placeholder names
      if (white === "?" || black === "?" || white === black) {
        current = {};
        continue;
      }

      games.push({
        white,
        black,
        white_elo: current["WhiteElo"] ? parseInt(current["WhiteElo"], 10) || null : null,
        black_elo: current["BlackElo"] ? parseInt(current["BlackElo"], 10) || null : null,
        white_fide_id: current["WhiteFideId"] ? parseInt(current["WhiteFideId"], 10) || null : null,
        black_fide_id: current["BlackFideId"] ? parseInt(current["BlackFideId"], 10) || null : null,
        white_title: current["WhiteTitle"] || null,
        black_title: current["BlackTitle"] || null,
        event: current["Event"] || null,
        date: current["Date"]?.replace(/\./g, "-") || null,
        result: current["Result"] || null,
      });
      current = {};
    } else if (trimmed.length > 0 && !trimmed.startsWith("[")) {
      // Move text line — reset for next game
      if (Object.keys(current).length > 0 && current["White"] && current["Black"]) {
        const white = current["White"];
        const black = current["Black"];

        if (white !== "?" && black !== "?" && white !== black) {
          games.push({
            white,
            black,
            white_elo: current["WhiteElo"] ? parseInt(current["WhiteElo"], 10) || null : null,
            black_elo: current["BlackElo"] ? parseInt(current["BlackElo"], 10) || null : null,
            white_fide_id: current["WhiteFideId"] ? parseInt(current["WhiteFideId"], 10) || null : null,
            black_fide_id: current["BlackFideId"] ? parseInt(current["BlackFideId"], 10) || null : null,
            white_title: current["WhiteTitle"] || null,
            black_title: current["BlackTitle"] || null,
            event: current["Event"] || null,
            date: current["Date"]?.replace(/\./g, "-") || null,
            result: current["Result"] || null,
          });
        }
      }
      current = {};
    }
  }

  return games;
}

function main() {
  const files = readdirSync(PGN_DIR)
    .filter((f) => f.endsWith(".pgn"))
    .sort();

  console.log(`Found ${files.length} PGN files to parse`);

  let totalGames = 0;
  const output = createWriteStream(OUTPUT_FILE);

  for (const file of files) {
    const filePath = join(PGN_DIR, file);
    process.stdout.write(`Parsing ${file}...`);
    const games = parsePgnFile(filePath);
    for (const game of games) {
      output.write(JSON.stringify(game) + "\n");
    }
    totalGames += games.length;
    process.stdout.write(` ${games.length} games\n`);
  }

  output.end();
  console.log(`\nTotal games parsed: ${totalGames}`);
  console.log(`Output written to: ${OUTPUT_FILE}`);
}

function createWriteStream(path: string) {
  const lines: string[] = [];
  return {
    write(line: string) {
      lines.push(line);
    },
    end() {
      writeFileSync(path, lines.join(""));
    },
  };
}

main();
