import { describe, it, expect } from "vitest";

/**
 * Tests for the BigInt ID precision issue in CockroachDB.
 *
 * CockroachDB unique_rowid() generates 19-digit INT8 values.
 * Number.MAX_SAFE_INTEGER is ~16 digits. Number() silently truncates,
 * causing enrichment queries (WHERE id = <truncated>) to return 0 rows.
 *
 * The fix: store the original BigInt alongside the truncated Number key
 * in the graph cache, and use it for all DB enrichment queries.
 */
describe("BigInt ID precision", () => {
  it("Number() truncates IDs beyond MAX_SAFE_INTEGER", () => {
    // Any integer above 2^53 may lose precision via Number()
    const bigId = 9007199254740993n; // MAX_SAFE_INTEGER + 2
    const truncated = Number(bigId);

    // Number() rounds — the round-trip loses the original value
    expect(BigInt(truncated)).not.toBe(bigId);
    expect(truncated).toBe(9007199254740992); // silently wrong

    // Realistic CockroachDB unique_rowid (19 digits, ~2^60)
    const crdbId = 1154981506829549579n;
    const crdbTruncated = Number(crdbId);
    expect(BigInt(crdbTruncated)).not.toBe(crdbId);
  });

  it("truncated IDs are still unique (no collisions) due to CockroachDB ID spacing", () => {
    // CockroachDB unique_rowid() values are spaced far apart (>> 256),
    // so even after Number() truncation, two different IDs won't collide.
    const id1 = 1154981506829549568n;
    const id2 = 1154981506829550592n;  // next ID (~1024 apart)

    const t1 = Number(id1);
    const t2 = Number(id2);

    // Both are truncated to different values — BFS works internally
    expect(t1).not.toBe(t2);
  });

  it("BigInt can be stored and retrieved for DB enrichment", () => {
    // Simulate the graph cache: Map<number, { bigId: bigint; ... }>
    const id1 = 1154981506829549568n;
    const id2 = 1155085150103764992n;

    const bfsPlayers = new Map<number, { bigId: bigint; birth_year: number | null; death_year: number | null }>();
    bfsPlayers.set(Number(id1), { bigId: id1, birth_year: 1990, death_year: null });
    bfsPlayers.set(Number(id2), { bigId: id2, birth_year: 1964, death_year: null });

    // The truncated key works for Map lookup
    const entry = bfsPlayers.get(Number(id1));
    expect(entry).toBeDefined();

    // The stored bigId is the exact original — safe for DB queries
    expect(entry!.bigId).toBe(1154981506829549568n);
    expect(entry!.bigId.toString()).toBe("1154981506829549568");

    // Enrichment query would use: WHERE id IN (1154981506829549568, ...)
    const pathIds = [Number(id1), Number(id2)];
    const bigIdList = pathIds.map(id => bfsPlayers.get(id)!.bigId).join(",");
    expect(bigIdList).toBe("1154981506829549568,1155085150103764992");
  });
});
