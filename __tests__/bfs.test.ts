import { describe, it, expect } from "vitest";
import { findShortestPathFromGraph, isChronologicallyCompatible } from "../lib/bfs";
import type { Player } from "../lib/types";

function makePlayer(id: number, name = "P"): Player {
  return { id, name: `${name}${id}`, fide_id: null, federation: null, title: null, birth_year: null, death_year: null };
}

describe("findShortestPathFromGraph", () => {
  it("returns distance 0 for same node", () => {
    const adj = new Map<number, any>();
    const pMap = new Map<number, Player>([[1, makePlayer(1)]]);
    adj.set(1, []);
    const res = findShortestPathFromGraph(adj, pMap, 1, 1);
    expect(res).toEqual({ distance: 0, path: [{ player: makePlayer(1), game_count: null }] });
  });

  it("returns null when no path exists", () => {
    const adj = new Map<number, any>();
    const pMap = new Map<number, Player>([[1, makePlayer(1)], [2, makePlayer(2)]]);
    adj.set(1, []);
    adj.set(2, []);
    const res = findShortestPathFromGraph(adj, pMap, 1, 2);
    expect(res).toBeNull();
  });

  it("finds a simple path A-B-C", () => {
    // A(1) - B(2) - C(3)
    const adj = new Map<number, any>();
    const pMap = new Map<number, Player>([[1, makePlayer(1)], [2, makePlayer(2)], [3, makePlayer(3)]]);
    const edge = (neighborId: number) => ({ neighborId, gameCount: 1, classicalCount: 1, rapidCount: 0, blitzCount: 0, firstGameDate: null, lastGameDate: null, firstGameYear: null, lastGameYear: null });
    adj.set(1, [edge(2)]);
    adj.set(2, [edge(1), edge(3)]);
    adj.set(3, [edge(2)]);
    const res = findShortestPathFromGraph(adj, pMap, 1, 3);
    expect(res).not.toBeNull();
    expect(res!.distance).toBe(2);
    expect(res!.path.map(p => p.player.id)).toEqual([1,2,3]);
  });

  it("respects chronological incompatibility between players", () => {
    // A(1) - B(2) - C(3) but B died before C born so A->C should be blocked
    const adj = new Map<number, any>();
    const p1 = { ...makePlayer(1), birth_year: 1800, death_year: 1850 };
    const p2 = { ...makePlayer(2), birth_year: 1820, death_year: 1880 };
    const p3 = { ...makePlayer(3), birth_year: 1900, death_year: 1950 };
    const pMap = new Map<number, Player>([[1,p1],[2,p2],[3,p3]]);
    const e12 = { neighborId: 2, gameCount: 1, classicalCount: 1, rapidCount: 0, blitzCount: 0, firstGameDate: null, lastGameDate: null, firstGameYear: 1840, lastGameYear: 1845 };
    const e23 = { neighborId: 3, gameCount: 1, classicalCount: 1, rapidCount: 0, blitzCount: 0, firstGameDate: null, lastGameDate: null, firstGameYear: 1905, lastGameYear: 1910 };
    adj.set(1, [e12]);
    adj.set(2, [{ neighborId:1, gameCount:1, classicalCount:1, rapidCount:0, blitzCount:0, firstGameDate:null, lastGameDate:null, firstGameYear:1840, lastGameYear:1845 }, e23]);
    adj.set(3, [{ neighborId:2, gameCount:1, classicalCount:1, rapidCount:0, blitzCount:0, firstGameDate:null, lastGameDate:null, firstGameYear:1905, lastGameYear:1910 }]);
    // Ensure isChronologicallyCompatible still allows edges individually
    expect(isChronologicallyCompatible(p1, p2)).toBe(true);
    expect(isChronologicallyCompatible(p2, p3)).toBe(false);
    const res = findShortestPathFromGraph(adj, pMap, 1, 3);
    // Because p2 and p3 have non-overlapping lifespans, path should be null
    expect(res).toBeNull();
  });

  it("honors time-control filter (classical) by ignoring edges with classicalCount=0", () => {
    // A(1) - B(2) - C(3), but middle edge has classicalCount=0 so classical filter breaks path
    const adj = new Map<number, any>();
    const pMap = new Map<number, Player>([[1, makePlayer(1)], [2, makePlayer(2)], [3, makePlayer(3)]]);
    const e12 = { neighborId: 2, gameCount: 5, classicalCount: 0, rapidCount: 0, blitzCount: 0, firstGameDate: null, lastGameDate: null, firstGameYear: null, lastGameYear: null };
    const e21 = { neighborId: 1, gameCount: 5, classicalCount: 0, rapidCount: 0, blitzCount: 0, firstGameDate: null, lastGameDate: null, firstGameYear: null, lastGameYear: null };
    const e23 = { neighborId: 3, gameCount: 2, classicalCount: 0, rapidCount: 0, blitzCount: 0, firstGameDate: null, lastGameDate: null, firstGameYear: null, lastGameYear: null };
    const e32 = { neighborId: 2, gameCount: 2, classicalCount: 0, rapidCount: 0, blitzCount: 0, firstGameDate: null, lastGameDate: null, firstGameYear: null, lastGameYear: null };
    adj.set(1, [e12]);
    adj.set(2, [e21, e23]);
    adj.set(3, [e32]);
    const resAll = findShortestPathFromGraph(adj, pMap, 1, 3, "all");
    expect(resAll).not.toBeNull();
    expect(resAll!.distance).toBe(2);
    const resClassical = findShortestPathFromGraph(adj, pMap, 1, 3, "classical");
    expect(resClassical).toBeNull();
  });
});
