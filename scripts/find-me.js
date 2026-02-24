const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "data", "pgn");
let found = [];
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith(".pgn")) continue;
  const c = fs.readFileSync(path.join(dir, f), "utf-8");
  if (c.toLowerCase().includes("mannelli") || c.toLowerCase().includes("mazzoli")) {
    // Find the relevant lines
    const lines = c.split("\n").filter(l => l.toLowerCase().includes("mannelli") || l.toLowerCase().includes("mazzoli"));
    found.push({ file: f, matches: lines.slice(0, 5) });
  }
}
if (found.length) {
  console.log("Found in files:");
  for (const f of found) {
    console.log(`  ${f.file}:`);
    f.matches.forEach(m => console.log(`    ${m.trim()}`));
  }
} else {
  console.log("Not found in any TWIC file");
  console.log("You'll need to be added manually to the database");
}
