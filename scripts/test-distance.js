const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log("Loading graph...");
  const edges = await sql`SELECT player_a_id, player_b_id, game_count FROM opponents`;
  console.log("Edges:", edges.length);

  const adj = new Map();
  for (const e of edges) {
    const a = e.player_a_id, b = e.player_b_id, gc = e.game_count;
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push({ id: b, gameCount: gc });
    adj.get(b).push({ id: a, gameCount: gc });
  }
  console.log("Nodes in graph:", adj.size);

  // Find Morphy and Carlsen
  const morphy = await sql`SELECT id, name FROM players WHERE name ILIKE '%morphy, paul%'`;
  const carlsen = await sql`SELECT id, name FROM players WHERE name ILIKE '%carlsen%magnus%' LIMIT 1`;
  console.log("Morphy:", morphy[0]);
  console.log("Carlsen:", carlsen[0]);

  const from = morphy[0].id;
  const to = carlsen[0].id;

  // Check neighbors
  const morphyNeighbors = adj.get(from) || [];
  console.log(`Morphy has ${morphyNeighbors.length} neighbors`);

  // BFS
  const visited = new Map();
  visited.set(from, { parent: null, gameCount: 0 });
  let queue = [from];
  let found = false;
  let depth = 0;

  while (queue.length > 0 && !found && depth < 20) {
    depth++;
    const next = [];
    for (const node of queue) {
      const neighbors = adj.get(node) || [];
      for (const n of neighbors) {
        if (!visited.has(n.id)) {
          visited.set(n.id, { parent: node, gameCount: n.gameCount });
          next.push(n.id);
          if (n.id === to) { found = true; break; }
        }
      }
      if (found) break;
    }
    queue = next;
    console.log(`  Depth ${depth}: explored ${next.length} new nodes`);
  }

  if (found) {
    const path = [];
    let cur = to;
    while (cur !== null) {
      const info = visited.get(cur);
      const player = await sql`SELECT name, title FROM players WHERE id = ${cur}`;
      path.unshift({ name: player[0].name, title: player[0].title, gameCount: info.gameCount });
      cur = info.parent;
    }
    console.log(`\nDistance: ${path.length - 1}`);
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      console.log(`  ${i}. ${p.title || ""} ${p.name} ${i > 0 ? `(${p.gameCount} games)` : ""}`);
    }
  } else {
    console.log("No path found!");
    // Show some of Morphy's neighbors
    for (const n of morphyNeighbors.slice(0, 10)) {
      const p = await sql`SELECT name FROM players WHERE id = ${n.id}`;
      console.log(`  Morphy neighbor: ${p[0].name} (${n.gameCount} games)`);
    }
  }
}

main().catch(console.error);
