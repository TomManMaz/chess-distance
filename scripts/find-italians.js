const fs = require("fs");
const path = require("path");

const targets = [
  { name: "Conti, Guido",            fide_id: "2814868", keywords: ["conti", "guido"] },
  { name: "Dal Pra Caputo, Stefano", fide_id: "838250",  keywords: ["dal pra", "dalpra", "caputo"] },
  { name: "Iannone, Alessandro",     fide_id: "28562089",keywords: ["iannone"] },
];

const pgnDir = path.join(__dirname, "..", "data", "pgn");
const files = fs.readdirSync(pgnDir).filter(f => f.endsWith(".pgn")).sort();

for (const t of targets) {
  console.log(`\n=== ${t.name} (FIDE ${t.fide_id}) ===`);
  const matchingFiles = [];
  for (const f of files) {
    const content = fs.readFileSync(path.join(pgnDir, f), "utf-8").toLowerCase();
    if (t.keywords.some(k => content.includes(k)) || content.includes(t.fide_id)) {
      matchingFiles.push(f);
    }
  }
  if (matchingFiles.length === 0) {
    console.log("  Not found in any TWIC file");
  } else {
    console.log(`  Found in: ${matchingFiles.join(", ")}`);
    // Show matching game headers
    for (const f of matchingFiles.slice(0, 3)) {
      const content = fs.readFileSync(path.join(pgnDir, f), "utf-8");
      const lines = content.split("\n");
      let headers = {};
      for (const l of lines) {
        const t2 = l.trim();
        if (t2.startsWith("[")) {
          const m = t2.match(/^\[(\w+)\s+"(.*)"\]$/);
          if (m) headers[m[1]] = m[2];
        } else if (t2 === "" && headers.White) {
          const hw = headers.White.toLowerCase(), hb = headers.Black.toLowerCase();
          if (t.keywords.some(k => hw.includes(k) || hb.includes(k)) ||
              headers.WhiteFideId === t.fide_id || headers.BlackFideId === t.fide_id) {
            console.log(`  [${f}] ${headers.White} vs ${headers.Black} (${headers.Date})`);
          }
          headers = {};
        }
      }
    }
  }
}
