const fs = require("fs");
const path = require("path");
const base = path.join(__dirname, "..", "data");
const dirs = fs.readdirSync(base);
for (const d of dirs) {
  const files = fs.readdirSync(path.join(base, d));
  console.log(`${d}: ${files.length} files`);
}
// Search for Knott
console.log("\nSearching for Knott...");
let found = false;
for (const d of dirs) {
  for (const f of fs.readdirSync(path.join(base, d))) {
    if (!f.endsWith(".pgn")) continue;
    const content = fs.readFileSync(path.join(base, d, f), "utf-8");
    if (content.includes("Knott")) {
      console.log(`  Found in ${d}/${f}`);
      found = true;
    }
  }
}
if (!found) console.log("  Not found in any file");
