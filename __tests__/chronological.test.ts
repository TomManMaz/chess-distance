/**
 * chronological.test.ts
 *
 * Unit tests for the chronological edge-compatibility logic in lib/bfs.ts.
 *
 * These tests run without any database connection — they exercise the pure
 * functions isChronologicallyCompatible() and findShortestPathFromGraph()
 * with hand-crafted in-memory player/edge data.
 *
 * Key scenario: FIDE ID 2842411 = Mannelli Mazzoli, Tommaso (born 1993).
 * He must NOT connect directly to players who died before 1993 (e.g. Morphy
 * died 1884, Lasker died 1941).  The BFS must skip such chronologically
 * impossible edges even if they somehow appear in the opponent table.
 */

import { describe, it, expect } from "vitest";
import { isChronologicallyCompatible, findShortestPathFromGraph } from "../lib/bfs";
import type { Player } from "../lib/types";

// ---------------------------------------------------------------------------
// Helper: build a minimal Player object
// ---------------------------------------------------------------------------
function player(
  id: number,
  name: string,
  birth_year: number | null,
  death_year: number | null
): Player {
  return { id, name, fide_id: null, federation: null, title: null, birth_year, death_year };
}

// ---------------------------------------------------------------------------
// isChronologicallyCompatible — pure function tests
// ---------------------------------------------------------------------------
describe("isChronologicallyCompatible", () => {
  it("allows contemporaries (Morphy vs Anderssen, both 1800s)", () => {
    expect(
      isChronologicallyCompatible(
        { birth_year: 1837, death_year: 1884 }, // Morphy
        { birth_year: 1818, death_year: 1879 }  // Anderssen
      )
    ).toBe(true);
  });

  it("blocks a player born long after the other died", () => {
    // Mannelli Mazzoli (b.1993) vs Morphy (d.1884) — impossible
    expect(
      isChronologicallyCompatible(
        { birth_year: 1993, death_year: null },
        { birth_year: 1837, death_year: 1884 }
      )
    ).toBe(false);
  });

  it("blocks in the reverse order too (symmetry)", () => {
    expect(
      isChronologicallyCompatible(
        { birth_year: 1837, death_year: 1884 }, // Morphy
        { birth_year: 1993, death_year: null }  // modern player
      )
    ).toBe(false);
  });

  it("blocks FIDE 2842411 (b.1993) vs Lasker (d.1941)", () => {
    expect(
      isChronologicallyCompatible(
        { birth_year: 1993, death_year: null },
        { birth_year: 1868, death_year: 1941 }  // Emanuel Lasker
      )
    ).toBe(false);
  });

  it("allows when both dates are null (unknown players)", () => {
    expect(
      isChronologicallyCompatible(
        { birth_year: null, death_year: null },
        { birth_year: null, death_year: null }
      )
    ).toBe(true);
  });

  it("allows when only one side has data and lifespans don't provably conflict", () => {
    // birth_year known but no death_year — could still be alive
    expect(
      isChronologicallyCompatible(
        { birth_year: 1990, death_year: null },
        { birth_year: 1950, death_year: null }
      )
    ).toBe(true);
  });

  it("blocks when death_year equals birth_year minus 1 (edge: died year before born)", () => {
    expect(
      isChronologicallyCompatible(
        { birth_year: 1900, death_year: 1950 }, // A died 1950
        { birth_year: 1951, death_year: null }  // B born 1951 — one year after A died
      )
    ).toBe(false);
  });

  it("allows when death_year equals birth_year (same year — could overlap)", () => {
    // A died 1951, B born 1951 — same year, could plausibly overlap
    expect(
      isChronologicallyCompatible(
        { birth_year: 1900, death_year: 1951 },
        { birth_year: 1951, death_year: null }
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findShortestPathFromGraph — BFS with chronological filtering
// ---------------------------------------------------------------------------

/**
 * Build a small adjacency map from a list of undirected edges.
 * Each edge is [idA, idB, gameCount].
 */
function buildAdj(edges: [number, number, number][]): Map<number, { neighborId: number; gameCount: number; classicalCount: number }[]> {
  const adj = new Map<number, { neighborId: number; gameCount: number; classicalCount: number }[]>();
  for (const [a, b, gc] of edges) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push({ neighborId: b, gameCount: gc, classicalCount: gc });
    adj.get(b)!.push({ neighborId: a, gameCount: gc, classicalCount: gc });
  }
  return adj;
}

describe("findShortestPathFromGraph — chronological filtering", () => {
  /**
   * Graph:
   *   Morphy (1837–1884) — Bird (1830–1908) — Lasker (1868–1941)
   *                                              |
   *                                   Mannelli (1993–)
   *
   * The Lasker—Mannelli edge is chronologically impossible (Lasker d.1941,
   * Mannelli b.1993) so the BFS must NOT traverse it.
   */
  const morphy    = player(1, "Morphy, Paul",           1837, 1884);
  const bird      = player(2, "Bird, Henry Edward",     1830, 1908);
  const lasker    = player(3, "Lasker, Emanuel",        1868, 1941);
  const mannelli  = player(4, "Mannelli Mazzoli, Tommaso", 1993, null);

  const pMap = new Map<number, Player>([
    [1, morphy], [2, bird], [3, lasker], [4, mannelli],
  ]);

  it("BFS skips the impossible Lasker→Mannelli edge when building the graph", () => {
    // Build adjacency WITHOUT applying the chronological filter (raw edges)
    const rawAdj = buildAdj([
      [1, 2, 5],  // Morphy — Bird
      [2, 3, 3],  // Bird — Lasker
      [3, 4, 1],  // Lasker — Mannelli (IMPOSSIBLE — should be filtered out)
    ]);

    // Apply chronological filter the same way loadGraph() does
    const filteredAdj = new Map<number, { neighborId: number; gameCount: number; classicalCount: number }[]>();
    for (const [nodeId, neighbors] of rawAdj) {
      const pA = pMap.get(nodeId)!;
      const filtered = neighbors.filter(({ neighborId }) => {
        const pB = pMap.get(neighborId)!;
        return isChronologicallyCompatible(pA, pB);
      });
      if (filtered.length > 0) filteredAdj.set(nodeId, filtered);
    }

    // Mannelli should not be reachable from Morphy because the only bridge
    // (Lasker→Mannelli) was removed by the chronological filter.
    const result = findShortestPathFromGraph(filteredAdj, pMap, 1, 4);
    expect(result).toBeNull();
  });

  it("finds a path when all edges are chronologically valid", () => {
    // Replace Mannelli with a 19th-century contemporary
    const pillsbury = player(4, "Pillsbury, Harry Nelson", 1872, 1906);
    const pMap2 = new Map<number, Player>([
      [1, morphy], [2, bird], [3, lasker], [4, pillsbury],
    ]);

    const adj = buildAdj([
      [1, 2, 5],  // Morphy — Bird
      [2, 3, 3],  // Bird — Lasker
      [3, 4, 2],  // Lasker — Pillsbury (valid: both active around 1900)
    ]);

    const result = findShortestPathFromGraph(adj, pMap2, 1, 4);
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(3);
    expect(result!.path.map(n => n.player.id)).toEqual([1, 2, 3, 4]);
  });

  it("returns distance 0 for same player", () => {
    const adj = buildAdj([[1, 2, 1]]);
    const result = findShortestPathFromGraph(adj, pMap, 1, 1);
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(0);
    expect(result!.path).toHaveLength(1);
  });

  it("returns null when players are disconnected", () => {
    // Two isolated components
    const adj = buildAdj([
      [1, 2, 1],  // component A
      [3, 4, 1],  // component B — no bridge
    ]);
    const result = findShortestPathFromGraph(adj, pMap, 1, 4);
    expect(result).toBeNull();
  });

  it("finds shortest path, not just any path (prefers 2-hop over 3-hop)", () => {
    // Graph with two routes: 1→2→4 (distance 2) and 1→3→... no direct to 4
    const p5 = player(5, "PlayerE", 1900, 1980);
    const pMap3 = new Map<number, Player>([
      [1, morphy], [2, bird], [3, lasker], [4, player(4, "PlayerD", 1870, 1950)], [5, p5],
    ]);
    const adj = buildAdj([
      [1, 2, 1],  // Morphy — Bird
      [1, 3, 1],  // Morphy — Lasker
      [2, 4, 1],  // Bird — PlayerD
      [3, 5, 1],  // Lasker — PlayerE
      [5, 4, 1],  // PlayerE — PlayerD
    ]);
    // Shortest: 1→2→4 (distance 2), not 1→3→5→4 (distance 3)
    const result = findShortestPathFromGraph(adj, pMap3, 1, 4);
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Specific scenario: FIDE 2842411 (born 1993) direct connections
// ---------------------------------------------------------------------------
describe("FIDE 2842411 scenario (Mannelli Mazzoli, Tommaso, b.1993)", () => {
  const mannelli = player(2842411, "Mannelli Mazzoli, Tommaso", 1993, null);

  // Only players whose death_year < 1993 (Mannelli's birth year).
  // Botvinnik (d.1995) and Fischer (d.2008) are NOT in this list — they were
  // still alive when Mannelli was born, so the edge is chronologically valid.
  const deadBeforeBorn = [
    player(1, "Morphy, Paul",           1837, 1884),
    player(2, "Lasker, Emanuel",        1868, 1941),
    player(3, "Capablanca, Jose Raul",  1888, 1942),
    player(4, "Alekhine, Alexander",    1892, 1946),
    player(5, "Euwe, Max",              1901, 1981),
  ];

  it("blocks direct edges from Mannelli to all players who died before 1993", () => {
    for (const opponent of deadBeforeBorn) {
      const compatible = isChronologicallyCompatible(mannelli, opponent);
      expect(compatible).toBe(
        false,
        `Expected edge to ${opponent.name} (d.${opponent.death_year}) to be blocked`
      );
    }
  });

  it("allows direct edges to players alive in 1993", () => {
    const aliveIn1993 = [
      player(100, "Carlsen, Magnus",     1990, null),
      player(101, "Kramnik, Vladimir",   1975, null),
      player(102, "Kasparov, Garry",     1963, null),
      player(103, "Karpov, Anatoly",     1951, null),
      // Botvinnik (d.1995) and Fischer (d.2008) died AFTER Mannelli was born —
      // they were alive in 1993 and so these edges are valid.
      player(104, "Botvinnik, Mikhail",  1911, 1995),
      player(105, "Fischer, Robert James", 1943, 2008),
    ];
    for (const opponent of aliveIn1993) {
      const compatible = isChronologicallyCompatible(mannelli, opponent);
      expect(compatible).toBe(
        true,
        `Expected edge to ${opponent.name} (b.${opponent.birth_year}) to be allowed`
      );
    }
  });
});
