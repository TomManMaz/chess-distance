import { getDb } from "./db";
import type { Player, DistanceResult, PathNode } from "./types";

export type TimeControlFilter = "all" | "classical";

interface AdjEntry {
  neighborId: number;
  gameCount: number;
  classicalCount: number;
  firstGameYear: number | null;
  lastGameYear: number | null;
}

interface GraphCache {
  adjacency: Map<number, AdjEntry[]>;
  playersMap: Map<number, Player>;
  loadedAt: number;
}

let cache: GraphCache | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Returns true when the two players could plausibly have played each other,
 * i.e. their lifespans are not provably non-overlapping.
 *
 * Only applied when the relevant birth/death year data is available for both
 * sides; missing data is treated as "unknown, allow the edge".
 */
export function isChronologicallyCompatible(
  a: { birth_year: number | null; death_year: number | null },
  b: { birth_year: number | null; death_year: number | null }
): boolean {
  // A died before B was born
  if (a.death_year !== null && b.birth_year !== null && a.death_year < b.birth_year) return false;
  // B died before A was born
  if (b.death_year !== null && a.birth_year !== null && b.death_year < a.birth_year) return false;
  return true;
}

// Extract the year from a DATE/timestamp value returned by the DB (string or Date).
function extractYear(dateVal: unknown): number | null {
  if (!dateVal) return null;
  const str = typeof dateVal === "string" ? dateVal : String(dateVal);
  const y = parseInt(str.substring(0, 4), 10);
  return isNaN(y) ? null : y;
}

// Tolerance for chronological overlap checks: two edges whose date windows are
// up to this many years apart are considered compatible (accounts for partially
// recorded careers, gaps in tournament data, etc.).
const CHRONO_TOLERANCE_YEARS = 10;

// Returns true if two consecutive hops through a node are chronologically
// plausible — i.e., the same physical player could have played both games.
// If either edge has no date data, the hop is always allowed (preserves
// connectivity for undated historical PGN records).
function chronoCompatible(
  incoming: AdjEntry | null,
  outgoing: AdjEntry | null
): boolean {
  // First hop from source/destination node — no constraint yet.
  if (incoming === null || outgoing === null) return true;

  const inFirst  = incoming.firstGameYear;
  const inLast   = incoming.lastGameYear;
  const outFirst = outgoing.firstGameYear;
  const outLast  = outgoing.lastGameYear;

  // If either edge has no date data at all, assume compatible.
  if ((inFirst === null && inLast === null) ||
      (outFirst === null && outLast === null)) return true;

  // Use the best available bound for each edge.
  const inEnd    = inLast   ?? inFirst!;
  const inStart  = inFirst  ?? inLast!;
  const outEnd   = outLast  ?? outFirst!;
  const outStart = outFirst ?? outLast!;

  // Incompatible if the eras are separated by more than the tolerance.
  if (inEnd   + CHRONO_TOLERANCE_YEARS < outStart) return false;
  if (outEnd  + CHRONO_TOLERANCE_YEARS < inStart)  return false;

  return true;
}

async function loadGraph(): Promise<GraphCache> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache;

  const sql = getDb();

  // Try to load birth_year/death_year; fall back to nulls if migration hasn't run yet
  let players: { id: number; name: string; fide_id: number | null; federation: string | null; title: string | null; birth_year: number | null; death_year: number | null }[];
  try {
    players = await sql`SELECT id, name, fide_id, federation, title, birth_year, death_year FROM players` as typeof players;
  } catch {
    players = await sql`SELECT id, name, fide_id, federation, title, NULL::smallint AS birth_year, NULL::smallint AS death_year FROM players` as typeof players;
  }
  const pMap = new Map<number, Player>();
  for (const row of players) {
    pMap.set(row.id as number, {
      id: row.id as number,
      name: row.name as string,
      fide_id: row.fide_id as number | null,
      federation: row.federation as string | null,
      title: row.title as string | null,
      birth_year: row.birth_year as number | null,
      death_year: row.death_year as number | null,
    });
  }

  // Try to load classical_count + dates; fall back gracefully if columns are missing.
  let edges: {
    player_a_id: number;
    player_b_id: number;
    game_count: number;
    classical_count: number;
    first_game_date: unknown;
    last_game_date: unknown;
  }[];
  try {
    edges = await sql`
      SELECT player_a_id, player_b_id, game_count, classical_count,
             first_game_date, last_game_date
      FROM opponents
    ` as typeof edges;
  } catch {
    edges = await sql`
      SELECT player_a_id, player_b_id, game_count, game_count AS classical_count,
             NULL AS first_game_date, NULL AS last_game_date
      FROM opponents
    ` as typeof edges;
  }

  const adj = new Map<number, AdjEntry[]>();
  for (const row of edges) {
    const a  = row.player_a_id as number;
    const b  = row.player_b_id as number;
    const gc = row.game_count as number;
    const cc = (row.classical_count as number) ?? gc;
    const fy = extractYear(row.first_game_date);
    const ly = extractYear(row.last_game_date);

    const pA = pMap.get(a);
    const pB = pMap.get(b);
    if (pA && pB && !isChronologicallyCompatible(pA, pB)) continue;

    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push({ neighborId: b, gameCount: gc, classicalCount: cc, firstGameYear: fy, lastGameYear: ly });
    adj.get(b)!.push({ neighborId: a, gameCount: gc, classicalCount: cc, firstGameYear: fy, lastGameYear: ly });
  }

  cache = { adjacency: adj, playersMap: pMap, loadedAt: now };
  return cache;
}

function edgeWeight(entry: AdjEntry, filter: TimeControlFilter): number {
  if (filter === "classical") return entry.classicalCount;
  return entry.gameCount;
}

function getGameCount(
  adj: Map<number, AdjEntry[]>,
  from: number,
  to: number,
  filter: TimeControlFilter
): number {
  const neighbors = adj.get(from);
  if (!neighbors) return 0;
  const entry = neighbors.find((e) => e.neighborId === to);
  if (!entry) return 0;
  return edgeWeight(entry, filter);
}

// Each visited node records its parent and the edge that was used to arrive,
// so the chronological filter can check consecutive hops.
type ParentEntry = { parent: number; via: AdjEntry | null };

/**
 * Pure bidirectional BFS that operates on an already-built adjacency map.
 * No database calls — suitable for unit testing with mock graph data.
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

  if (!adj.has(fromId) || !adj.has(toId)) return null;

  // Bidirectional BFS
  const parentForward  = new Map<number, ParentEntry>();
  const parentBackward = new Map<number, ParentEntry>();
  parentForward.set(fromId,  { parent: -1, via: null });
  parentBackward.set(toId,   { parent: -1, via: null });

  let frontierForward  = [fromId];
  let frontierBackward = [toId];
  let meetingNode = -1;

  outer: while (frontierForward.length > 0 && frontierBackward.length > 0) {
    // Expand the smaller frontier
    if (frontierForward.length <= frontierBackward.length) {
      const nextFrontier: number[] = [];
      for (const node of frontierForward) {
        const neighbors = adj.get(node);
        if (!neighbors) continue;
        // The edge used to arrive at this node from the forward direction
        const incomingVia = parentForward.get(node)!.via;
        const sorted = neighbors
          .filter((e) => edgeWeight(e, tcFilter) > 0)
          .sort((a, b) => edgeWeight(b, tcFilter) - edgeWeight(a, tcFilter));
        for (const entry of sorted) {
          const { neighborId } = entry;
          if (parentForward.has(neighborId)) continue;
          // Chronological check: can the same player have played both games?
          if (!chronoCompatible(incomingVia, entry)) continue;
          parentForward.set(neighborId, { parent: node, via: entry });
          if (parentBackward.has(neighborId)) {
            // Also validate the junction: the forward edge into this node must
            // be chronologically compatible with the backward edge into it.
            const bkwdVia = parentBackward.get(neighborId)!.via;
            if (chronoCompatible(entry, bkwdVia)) {
              meetingNode = neighborId;
              break outer;
            }
            // Invalid junction — don't use this node as the meeting point;
            // continue searching for a valid one.
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
        // The edge used to arrive at this node from the backward direction
        const incomingVia = parentBackward.get(node)!.via;
        const sorted = neighbors
          .filter((e) => edgeWeight(e, tcFilter) > 0)
          .sort((a, b) => edgeWeight(b, tcFilter) - edgeWeight(a, tcFilter));
        for (const entry of sorted) {
          const { neighborId } = entry;
          if (parentBackward.has(neighborId)) continue;
          // Chronological check (symmetric — same function for both directions)
          if (!chronoCompatible(incomingVia, entry)) continue;
          parentBackward.set(neighborId, { parent: node, via: entry });
          if (parentForward.has(neighborId)) {
            // Validate junction with the forward edge already stored at this node
            const fwdVia = parentForward.get(neighborId)!.via;
            if (chronoCompatible(fwdVia, entry)) {
              meetingNode = neighborId;
              break outer;
            }
            // Invalid junction — continue searching
          } else {
            nextFrontier.push(neighborId);
          }
        }
      }
      frontierBackward = nextFrontier;
    }
  }

  if (meetingNode === -1) return null;

  // Reconstruct path
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

  const fullPath = [...pathForward, ...pathBackward];
  const result: PathNode[] = fullPath.map((nodeId, i) => {
    const player = pMap.get(nodeId)!;
    const nextNodeId = fullPath[i + 1];
    const gc = nextNodeId !== undefined ? getGameCount(adj, nodeId, nextNodeId, tcFilter) : null;
    return { player, game_count: gc };
  });

  return { distance: fullPath.length - 1, path: result };
}

export async function findShortestPath(
  fromId: number,
  toId: number,
  tcFilter: TimeControlFilter = "all"
): Promise<DistanceResult | null> {
  const { adjacency: adj, playersMap: pMap } = await loadGraph();
  return findShortestPathFromGraph(adj, pMap, fromId, toId, tcFilter);
}
