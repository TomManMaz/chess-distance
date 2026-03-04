/**
 * Benchmark the distance calculation: graph load time vs BFS time.
 *
 * Usage (from repo root, with DATABASE_URL in env or .env.local):
 *   npx tsx scripts/benchmark-distance.ts [fromId] [toId]
 *
 * Defaults: searches for Carlsen vs Kasparov by name.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// Load .env.local before importing anything that touches DB
const envFile = resolve(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    process.env[key] = val;
  }
}

import { getDb } from "@/lib/db";
import { findShortestPath, invalidateCache } from "@/lib/bfs";

async function lookupId(name: string): Promise<number | null> {
  const sql = getDb();
  // Exact match first, then prefix — avoids "Kasparov, Garry:..." junk rows
  const rows = await sql<{ id: number; name: string; game_count: bigint }[]>`
    SELECT p.id, p.name,
           COALESCE((SELECT SUM(game_count) FROM opponents WHERE player_a_id = p.id), 0) +
           COALESCE((SELECT SUM(game_count) FROM opponents WHERE player_b_id = p.id), 0) AS game_count
    FROM players p
    WHERE p.name = ${name}
    ORDER BY game_count DESC
    LIMIT 1
  `;
  if (rows[0]) {
    console.log(`  "${rows[0].name}" id=${rows[0].id} games=${rows[0].game_count}`);
    return Number(rows[0].id);
  }
  return null;
}

async function bench(label: string, fn: () => Promise<unknown>): Promise<void> {
  const start = performance.now();
  const result = await fn();
  const ms = performance.now() - start;
  console.log(`[${label}] ${ms.toFixed(0)} ms`);
  return result as void;
}

async function main() {
  const args = process.argv.slice(2);
  let fromId: number | null = null;
  let toId: number | null = null;

  if (args.length >= 2) {
    fromId = parseInt(args[0], 10);
    toId = parseInt(args[1], 10);
  } else {
    console.log("Looking up Carlsen and Kasparov by name...");
    [fromId, toId] = await Promise.all([
      lookupId("Carlsen, Magnus"),
      lookupId("Kasparov, Garry"),
    ]);
    if (!fromId || !toId) {
      console.error("Could not find player IDs. Try passing them as arguments.");
      process.exit(1);
    }
    console.log(`  Carlsen: ${fromId}`);
    console.log(`  Kasparov: ${toId}`);
  }

  console.log("\n=== Cold start (graph not loaded) ===");
  invalidateCache();
  let result: Awaited<ReturnType<typeof findShortestPath>>;
  await bench("total (load graph + BFS)", async () => {
    result = await findShortestPath(fromId!, toId!, "all");
  });

  console.log("\n=== Warm (graph already in memory) ===");
  await bench("BFS only (cached graph)", async () => {
    result = await findShortestPath(fromId!, toId!, "all");
  });

  if (result!) {
    console.log(`\nPath length: ${result.distance} hops`);
    console.log("Path:", result.path.map((n) => n.player?.name ?? "(unknown)").join(" → "));
  } else {
    console.log("\nNo path found.");
  }

  console.log("\n=== Classical-only filter (warm) ===");
  await bench("BFS classical filter (cached graph)", async () => {
    await findShortestPath(fromId!, toId!, "classical");
  });

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
