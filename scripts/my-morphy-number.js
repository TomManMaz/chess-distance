const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

async function main() {
  console.log("Loading graph from DB...");
  const edges = await sql`SELECT player_a_id, player_b_id FROM opponents`;
  console.log(`Loaded ${edges.length} edges`);

  const adj = new Map();
  for (const e of edges) {
    const a = e.player_a_id, b = e.player_b_id;
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }

  const morphyId = 157633;   // Morphy, Paul
  const tommasoId = 239909;  // Mannelli Mazzoli, Tommaso

  console.log(`Morphy neighbors: ${(adj.get(morphyId) || []).length}`);
  console.log(`Tommaso neighbors: ${(adj.get(tommasoId) || []).length}`);

  // Bidirectional BFS
  const fromVisited = new Map([[morphyId, { parent: null }]]);
  const toVisited   = new Map([[tommasoId, { parent: null }]]);
  let fromQueue = [morphyId];
  let toQueue   = [tommasoId];
  let meetNode = null;

  outer: for (let depth = 0; depth < 20 && !meetNode; depth++) {
    const next = [];
    for (const node of fromQueue) {
      for (const nb of adj.get(node) || []) {
        if (!fromVisited.has(nb)) {
          fromVisited.set(nb, { parent: node });
          next.push(nb);
          if (toVisited.has(nb)) { meetNode = nb; break outer; }
        }
      }
    }
    fromQueue = next;
    console.log(`  From Morphy depth ${depth+1}: ${fromVisited.size} nodes`);

    const next2 = [];
    for (const node of toQueue) {
      for (const nb of adj.get(node) || []) {
        if (!toVisited.has(nb)) {
          toVisited.set(nb, { parent: node });
          next2.push(nb);
          if (fromVisited.has(nb)) { meetNode = nb; break outer; }
        }
      }
    }
    toQueue = next2;
    console.log(`  From Tommaso depth ${depth+1}: ${toVisited.size} nodes`);
  }

  if (!meetNode) { console.log("No path found!"); return; }

  // Trace path from Morphy to meetNode
  const pathFrom = [];
  let cur = meetNode;
  while (cur !== null) {
    pathFrom.unshift(cur);
    cur = fromVisited.get(cur).parent;
  }

  // Trace path from Tommaso to meetNode
  const pathTo = [];
  cur = toVisited.get(meetNode).parent;
  while (cur !== null) {
    pathTo.push(cur);
    cur = toVisited.get(cur).parent;
  }

  const fullPath = [...pathFrom, ...pathTo];
  console.log(`\nYour Morphy number: ${fullPath.length - 1}`);
  console.log("\nPath:");
  for (const id of fullPath) {
    const p = await sql`SELECT name, title FROM players WHERE id = ${id}`;
    const marker = id === morphyId ? " ← Morphy" : id === tommasoId ? " ← YOU" : "";
    console.log(`  ${p[0].title || ""} ${p[0].name}${marker}`);
  }
}

main().catch(console.error);
