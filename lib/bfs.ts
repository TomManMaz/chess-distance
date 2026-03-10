import { getDb } from "./db";
import type { Player, DistanceResult, PathNode } from "./types";

export type TimeControlFilter = "all" | "classical";

// Lean adjacency entry stored in the graph cache.
// rapid_count / blitz_count / game dates are NOT cached globally — they are
// fetched via a targeted enrichment query for the small set of returned path
// edges only, cutting cold-start data transfer by ~75%.
interface AdjEntry {
  neighborId: number;
  gameCount: number;
  classicalCount: number;
  firstGameYear: number | null;
  lastGameYear: number | null;
}

interface GraphCache {
  adjacency: Map<number, AdjEntry[]>;
  // Lean player map — only birth/death years needed for BFS traversal.
  // Full player data (name, federation, etc.) is fetched post-BFS for the path only.
  bfsPlayers: Map<number, { birth_year: number | null; death_year: number | null }>;
  loadedAt: number;
}

let cache: GraphCache | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export function invalidateCache(): void {
  cache = null;
}

/**
 * Returns true when the two players could plausibly have played each other,
 * i.e. their lifespans are not provably non-overlapping.
 */
export function isChronologicallyCompatible(
  a: { birth_year: number | null; death_year: number | null },
  b: { birth_year: number | null; death_year: number | null }
): boolean {
  if (a.death_year !== null && b.birth_year !== null && a.death_year < b.birth_year) return false;
  if (b.death_year !== null && a.birth_year !== null && b.death_year < a.birth_year) return false;
  return true;
}

const CHRONO_TOLERANCE_YEARS = 10;

function chronoCompatible(
  incoming: AdjEntry | null,
  outgoing: AdjEntry | null
): boolean {
  if (incoming === null || outgoing === null) return true;

  const inFirst  = incoming.firstGameYear;
  const inLast   = incoming.lastGameYear;
  const outFirst = outgoing.firstGameYear;
  const outLast  = outgoing.lastGameYear;

  if ((inFirst === null && inLast === null) ||
      (outFirst === null && outLast === null)) return true;

  const inEnd    = inLast   ?? inFirst!;
  const inStart  = inFirst  ?? inLast!;
  const outEnd   = outLast  ?? outFirst!;
  const outStart = outFirst ?? outLast!;

  if (inEnd   + CHRONO_TOLERANCE_YEARS < outStart) return false;
  if (outEnd  + CHRONO_TOLERANCE_YEARS < inStart)  return false;

  return true;
}

export function isCacheWarm(): boolean {
  return cache !== null && Date.now() - cache.loadedAt < CACHE_TTL_MS;
}

async function loadGraph(onStatus?: (msg: string) => void): Promise<GraphCache> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache;

  const sql = getDb();

  // Load ONLY the minimal player fields needed for BFS (birth/death years for
  // chronological compatibility). Name, title, federation etc. are fetched
  // post-BFS for the ~5-8 path players only — saving ~50MB of network transfer.
  onStatus?.("Loading players…");
  const playerRows = await sql`
    SELECT id, birth_year, death_year FROM players
  ` as { id: number; birth_year: number | null; death_year: number | null }[];

  const bfsPlayers = new Map<number, { birth_year: number | null; death_year: number | null }>();
  for (const row of playerRows) {
    bfsPlayers.set(Number(row.id), {
      birth_year: row.birth_year != null ? Number(row.birth_year) : null,
      death_year: row.death_year != null ? Number(row.death_year) : null,
    });
  }

  onStatus?.("Loading game graph…");
  // Load opponent edges with only the columns needed for BFS traversal.
  // rapid_count, blitz_count, first_game_date, last_game_date are NOT fetched
  // here — saves ~30MB of network transfer on cold start.
  // EXTRACT(YEAR FROM date) avoids sending full date strings (~10 bytes each).
  let edgeRows: {
    player_a_id: number;
    player_b_id: number;
    game_count: number;
    classical_count: number;
    first_game_year: number | null;
    last_game_year: number | null;
  }[];
  try {
    edgeRows = await sql`
      SELECT player_a_id, player_b_id, game_count, classical_count,
             EXTRACT(YEAR FROM first_game_date)::int AS first_game_year,
             EXTRACT(YEAR FROM last_game_date)::int AS last_game_year
      FROM opponents
    ` as typeof edgeRows;
  } catch {
    edgeRows = await sql`
      SELECT player_a_id, player_b_id, game_count, game_count AS classical_count,
             NULL::int AS first_game_year, NULL::int AS last_game_year
      FROM opponents
    ` as typeof edgeRows;
  }

  const adj = new Map<number, AdjEntry[]>();
  for (const row of edgeRows) {
    const a  = Number(row.player_a_id);
    const b  = Number(row.player_b_id);
    const gc = Number(row.game_count);
    const cc = Number(row.classical_count) || gc;
    const fy = row.first_game_year != null ? Number(row.first_game_year) : null;
    const ly = row.last_game_year  != null ? Number(row.last_game_year)  : null;

    const pA = bfsPlayers.get(a);
    const pB = bfsPlayers.get(b);
    if (pA && pB && !isChronologicallyCompatible(pA, pB)) continue;

    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push({ neighborId: b, gameCount: gc, classicalCount: cc, firstGameYear: fy, lastGameYear: ly });
    adj.get(b)!.push({ neighborId: a, gameCount: gc, classicalCount: cc, firstGameYear: fy, lastGameYear: ly });
  }

  onStatus?.("Building search index…");
  cache = { adjacency: adj, bfsPlayers, loadedAt: now };
  return cache;
}

function edgeWeight(entry: AdjEntry, filter: TimeControlFilter): number {
  if (filter === "classical") return entry.classicalCount;
  return entry.gameCount;
}

type ParentEntry = { parent: number; via: AdjEntry | null };

/**
 * Raw bidirectional BFS on an adjacency map. Returns the path as an array of
 * player IDs, or null if no path exists. No DB calls; suitable for unit tests.
 *
 * Accepts any map whose values have birth_year / death_year (structural typing).
 */
export function bfsRaw(
  adj: Map<number, AdjEntry[]>,
  bfsPlayers: Map<number, { birth_year: number | null; death_year: number | null }>,
  fromId: number,
  toId: number,
  tcFilter: TimeControlFilter = "all"
): number[] | null {
  if (fromId === toId) return [fromId];
  if (!adj.has(fromId) || !adj.has(toId)) return null;

  const parentForward  = new Map<number, ParentEntry>();
  const parentBackward = new Map<number, ParentEntry>();
  parentForward.set(fromId, { parent: -1, via: null });
  parentBackward.set(toId,  { parent: -1, via: null });

  let frontierForward  = [fromId];
  let frontierBackward = [toId];
  let meetingNode = -1;

  outer: while (frontierForward.length > 0 && frontierBackward.length > 0) {
    if (frontierForward.length <= frontierBackward.length) {
      const nextFrontier: number[] = [];
      for (const node of frontierForward) {
        const neighbors = adj.get(node);
        if (!neighbors) continue;
        const incomingVia = parentForward.get(node)!.via;
        const sorted = neighbors
          .filter((e) => edgeWeight(e, tcFilter) > 0)
          .sort((a, b) => edgeWeight(b, tcFilter) - edgeWeight(a, tcFilter));
        for (const entry of sorted) {
          const { neighborId } = entry;
          if (parentForward.has(neighborId)) continue;
          if (!chronoCompatible(incomingVia, entry)) continue;
          parentForward.set(neighborId, { parent: node, via: entry });
          if (parentBackward.has(neighborId)) {
            const bkwdVia = parentBackward.get(neighborId)!.via;
            if (chronoCompatible(entry, bkwdVia)) {
              meetingNode = neighborId;
              break outer;
            }
          } else {
            nextFrontier.push(neighborId);
          }
        }
      }
      frontierForward = nextFrontier;
    } else {
      const nextFrontier: number[] = [];
      for (const node of frontierBackward) {
        const neighbors = adj.get(node);
        if (!neighbors) continue;
        const incomingVia = parentBackward.get(node)!.via;
        const sorted = neighbors
          .filter((e) => edgeWeight(e, tcFilter) > 0)
          .sort((a, b) => edgeWeight(b, tcFilter) - edgeWeight(a, tcFilter));
        for (const entry of sorted) {
          const { neighborId } = entry;
          if (parentBackward.has(neighborId)) continue;
          if (!chronoCompatible(incomingVia, entry)) continue;
          parentBackward.set(neighborId, { parent: node, via: entry });
          if (parentForward.has(neighborId)) {
            const fwdVia = parentForward.get(neighborId)!.via;
            if (chronoCompatible(fwdVia, entry)) {
              meetingNode = neighborId;
              break outer;
            }
          } else {
            nextFrontier.push(neighborId);
          }
        }
      }
      frontierBackward = nextFrontier;
    }
  }

  if (meetingNode === -1) return null;

  const pathForward: number[] = [];
  let cur = meetingNode;
  while (cur !== -1) {
    pathForward.unshift(cur);
    cur = parentForward.get(cur)?.parent ?? -1;
  }

  const pathBackward: number[] = [];
  cur = parentBackward.get(meetingNode)?.parent ?? -1;
  while (cur !== -1) {
    pathBackward.push(cur);
    cur = parentBackward.get(cur)?.parent ?? -1;
  }

  return [...pathForward, ...pathBackward];
}

/**
 * Pure bidirectional BFS that operates on an already-built adjacency map.
 * Takes full Player objects and builds a complete DistanceResult.
 * No database calls — used by unit tests with mock graph data.
 */
export function findShortestPathFromGraph(
  adj: Map<number, AdjEntry[]>,
  pMap: Map<number, Player>,
  fromId: number,
  toId: number,
  tcFilter: TimeControlFilter = "all"
): DistanceResult | null {
  if (fromId === toId) {
    const player = pMap.get(fromId);
    if (!player) return null;
    return { distance: 0, path: [{ player, game_count: null }] };
  }

  const rawPath = bfsRaw(adj, pMap, fromId, toId, tcFilter);
  if (!rawPath) return null;

  const result: PathNode[] = rawPath.map((nodeId, i) => {
    const player = pMap.get(nodeId)!;
    const nextNodeId = rawPath[i + 1];
    let gc = null;
    let cc = 0;
    if (nextNodeId !== undefined) {
      const neighbors = adj.get(nodeId);
      if (neighbors) {
        const entry = neighbors.find((e) => e.neighborId === nextNodeId);
        if (entry) {
          gc = edgeWeight(entry, tcFilter);
          cc = entry.classicalCount;
        }
      }
    }
    return {
      player,
      game_count: gc,
      first_game_date: null,
      last_game_date: null,
      classical_count: cc,
      rapid_count: 0,
      blitz_count: 0,
    };
  });

  return { distance: rawPath.length - 1, path: result };
}

/**
 * Production BFS: loads the lean graph, runs BFS, then enriches the short
 * returned path with full player data and edge metadata via targeted DB queries.
 * onStatus is called at each stage so callers can stream progress to the client.
 */
export async function findShortestPath(
  fromId: number,
  toId: number,
  tcFilter: TimeControlFilter = "all",
  onStatus?: (msg: string) => void
): Promise<DistanceResult | null> {
  const { adjacency: adj, bfsPlayers } = await loadGraph(onStatus);

  if (fromId === toId) {
    const sql = getDb();
    const rows = await sql.unsafe<{ id: number; name: string; fide_id: number | null; federation: string | null; title: string | null; birth_year: number | null; death_year: number | null }[]>(
      `SELECT id, name, fide_id, federation, title, birth_year, death_year FROM players WHERE id = ${fromId}`
    );
    if (!rows[0]) return null;
    const p: Player = {
      id: Number(rows[0].id),
      name: rows[0].name,
      fide_id: rows[0].fide_id != null ? Number(rows[0].fide_id) : null,
      federation: rows[0].federation,
      title: rows[0].title,
      birth_year: rows[0].birth_year != null ? Number(rows[0].birth_year) : null,
      death_year: rows[0].death_year != null ? Number(rows[0].death_year) : null,
    };
    return { distance: 0, path: [{ player: p, game_count: null }] };
  }

  onStatus?.("Searching for shortest path…");
  const rawPath = bfsRaw(adj, bfsPlayers, fromId, toId, tcFilter);
  if (!rawPath) return null;

  onStatus?.("Fetching path details…");
  const sql = getDb();

  // Enrich: fetch full player data for path nodes only (~5-8 rows)
  const idList = rawPath.join(",");
  const playerRows = await sql.unsafe<{ id: number; name: string; fide_id: number | null; federation: string | null; title: string | null; birth_year: number | null; death_year: number | null }[]>(
    `SELECT id, name, fide_id, federation, title, birth_year, death_year FROM players WHERE id IN (${idList})`
  );
  const playerMap = new Map<number, Player>();
  for (const row of playerRows) {
    const id = Number(row.id);
    playerMap.set(id, {
      id,
      name: row.name,
      fide_id: row.fide_id != null ? Number(row.fide_id) : null,
      federation: row.federation,
      title: row.title,
      birth_year: row.birth_year != null ? Number(row.birth_year) : null,
      death_year: row.death_year != null ? Number(row.death_year) : null,
    });
  }

  // Enrich: fetch edge metadata for path edges only (~4-7 rows)
  type EdgeRow = { player_a_id: number; player_b_id: number; rapid_count: number; blitz_count: number; first_game_date: string | null; last_game_date: string | null };
  let edgeMap = new Map<string, EdgeRow>();
  if (rawPath.length > 1) {
    const clauses = [];
    for (let i = 0; i < rawPath.length - 1; i++) {
      const a = Math.min(rawPath[i], rawPath[i + 1]);
      const b = Math.max(rawPath[i], rawPath[i + 1]);
      clauses.push(`(player_a_id = ${a} AND player_b_id = ${b})`);
    }
    try {
      const edgeRows = await sql.unsafe<EdgeRow[]>(
        `SELECT player_a_id, player_b_id, rapid_count, blitz_count, first_game_date, last_game_date FROM opponents WHERE ${clauses.join(" OR ")}`
      );
      for (const row of edgeRows) {
        edgeMap.set(`${Number(row.player_a_id)},${Number(row.player_b_id)}`, row);
      }
    } catch {
      // rapid/blitz columns may not exist — leave edgeMap empty
    }
  }

  // Build enriched PathNode array
  const path: PathNode[] = rawPath.map((nodeId, i) => {
    const player = playerMap.get(nodeId) ?? {
      id: nodeId, name: String(nodeId), fide_id: null,
      federation: null, title: null, birth_year: null, death_year: null,
    };
    const nextNodeId = rawPath[i + 1];
    let gc = null;
    let cc = 0;
    let rc = 0;
    let bc = 0;
    let fd: string | null = null;
    let ld: string | null = null;

    if (nextNodeId !== undefined) {
      // Game count from the lean adj (already in memory)
      const neighbors = adj.get(nodeId);
      if (neighbors) {
        const entry = neighbors.find((e) => e.neighborId === nextNodeId);
        if (entry) {
          gc = edgeWeight(entry, tcFilter);
          cc = entry.classicalCount;
        }
      }
      // Rich metadata from the enrichment query
      const a = Math.min(nodeId, nextNodeId);
      const b = Math.max(nodeId, nextNodeId);
      const edgeRow = edgeMap.get(`${a},${b}`);
      if (edgeRow) {
        rc = Number(edgeRow.rapid_count) || 0;
        bc = Number(edgeRow.blitz_count) || 0;
        fd = edgeRow.first_game_date ? String(edgeRow.first_game_date) : null;
        ld = edgeRow.last_game_date  ? String(edgeRow.last_game_date)  : null;
      }
    }

    return {
      player,
      game_count: gc,
      first_game_date: fd,
      last_game_date: ld,
      classical_count: cc,
      rapid_count: rc,
      blitz_count: bc,
    };
  });

  return { distance: rawPath.length - 1, path };
}
