/**
 * Tests for getTopNeighbors — BigInt safety and result shape.
 *
 * getTopNeighbors accepts a bigint | number id and must pass it to postgres.js
 * as a BigInt so CockroachDB receives the exact 64-bit value.  Converting with
 * Number() silently rounds unique_rowid() values that exceed MAX_SAFE_INTEGER,
 * causing the WHERE clause to match the wrong row or return no rows.
 *
 * The TypeScript build also had a type error:
 *   await sql<NeighborData[]>`...`
 * fails when postgres.js cannot resolve PendingQuery<NeighborData[]> as a
 * proper PromiseLike.  The fix is to annotate the variable instead:
 *   const rows: NeighborData[] = await sql`...`
 */

import { describe, it, expect, vi } from "vitest";
import { getTopNeighbors } from "../lib/player";
import { getDb } from "../lib/db";

vi.mock("../lib/db", () => ({ getDb: vi.fn() }));

// Realistic unique_rowid() that exceeds MAX_SAFE_INTEGER.
// Number(BIG_ID) !== BIG_ID — precision is lost.
const BIG_ID = 870_123_456_789_012_345n;

// ---------------------------------------------------------------------------
// Basic shape
// ---------------------------------------------------------------------------

describe("getTopNeighbors — result shape", () => {
  it("returns an empty array when the player has no recorded opponents", async () => {
    const fakeSql = vi.fn().mockResolvedValueOnce([]);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(fakeSql);

    const result = await getTopNeighbors(BIG_ID);
    expect(result).toEqual([]);
  });

  it("returns neighbors with all expected fields present", async () => {
    const neighborRow = {
      id: 123n,
      name: "Nakamura, Hikaru",
      title: "GM",
      federation: "USA",
      game_count: 50,
      slug: "hikaru-nakamura",
    };
    const fakeSql = vi.fn().mockResolvedValueOnce([neighborRow]);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(fakeSql);

    const result = await getTopNeighbors(BIG_ID);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Nakamura, Hikaru");
    expect(result[0].title).toBe("GM");
    expect(result[0].federation).toBe("USA");
    expect(result[0].game_count).toBe(50);
    expect(result[0].slug).toBe("hikaru-nakamura");
  });

  it("handles neighbors with null optional fields (title, federation, slug)", async () => {
    const neighborRow = {
      id: 456n,
      name: "Historical, Player",
      title: null,
      federation: null,
      game_count: 3,
      slug: null,
    };
    const fakeSql = vi.fn().mockResolvedValueOnce([neighborRow]);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(fakeSql);

    const result = await getTopNeighbors(BIG_ID);
    expect(result[0].title).toBeNull();
    expect(result[0].federation).toBeNull();
    expect(result[0].slug).toBeNull();
  });

  it("returns multiple neighbors", async () => {
    const rows = [
      { id: 1n, name: "A, Player", title: null, federation: "NOR", game_count: 100, slug: "player-a" },
      { id: 2n, name: "B, Player", title: "GM", federation: "USA", game_count: 80, slug: "player-b" },
      { id: 3n, name: "C, Player", title: "IM", federation: "RUS", game_count: 60, slug: "player-c" },
    ];
    const fakeSql = vi.fn().mockResolvedValueOnce(rows);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(fakeSql);

    const result = await getTopNeighbors(BIG_ID);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.name)).toEqual(["A, Player", "B, Player", "C, Player"]);
  });
});

// ---------------------------------------------------------------------------
// BigInt precision
// ---------------------------------------------------------------------------

describe("getTopNeighbors — BigInt ID handling", () => {
  it("confirms BIG_ID exceeds Number.MAX_SAFE_INTEGER", () => {
    expect(BIG_ID > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("confirms Number() loses precision on BIG_ID", () => {
    expect(BigInt(Number(BIG_ID))).not.toBe(BIG_ID);
  });

  it("passes a BigInt to the SQL query when given a bigint id", async () => {
    const fakeSql = vi.fn().mockResolvedValueOnce([]);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(fakeSql);

    await getTopNeighbors(BIG_ID);

    // Template-tag call: fakeSql(strings, ...interpolatedValues)
    const interpolated = fakeSql.mock.calls[0].slice(1);
    const bigIntArgs = interpolated.filter((a: unknown) => typeof a === "bigint");
    expect(bigIntArgs.length).toBeGreaterThan(0);
    expect(bigIntArgs[0]).toBe(BIG_ID);
  });

  it("passes a BigInt to the SQL query when given a safe-integer number id", async () => {
    const safeId = 1503014; // FIDE-range — fits in Number safely
    const fakeSql = vi.fn().mockResolvedValueOnce([]);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(fakeSql);

    await getTopNeighbors(safeId);

    const interpolated = fakeSql.mock.calls[0].slice(1);
    const bigIntArgs = interpolated.filter((a: unknown) => typeof a === "bigint");
    expect(bigIntArgs.length).toBeGreaterThan(0);
    expect(bigIntArgs[0]).toBe(BigInt(safeId));
  });

  it("the BigInt id appears twice in the query (player_a_id and player_b_id branches)", async () => {
    const fakeSql = vi.fn().mockResolvedValueOnce([]);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(fakeSql);

    await getTopNeighbors(BIG_ID);

    // The UNION ALL query has ${pgId} twice (once per branch).
    const interpolated = fakeSql.mock.calls[0].slice(1);
    const bigIntArgs = interpolated.filter((a: unknown) => typeof a === "bigint");
    expect(bigIntArgs.length).toBe(2);
    bigIntArgs.forEach((arg: bigint) => expect(arg).toBe(BIG_ID));
  });
});
