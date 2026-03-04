/**
 * Tests that verify getPlayerBySlug correctly handles CockroachDB's BigInt IDs.
 *
 * CockroachDB unique_rowid() values are ~19-digit integers that exceed
 * Number.MAX_SAFE_INTEGER (2^53 - 1 = 9_007_199_254_740_991). Converting them
 * with Number() silently rounds the value, causing the second WHERE clause to
 * match the wrong (or no) row → 404.
 *
 * The fix: keep the BigInt returned by postgres.js and pass it directly into
 * tagged template literals so the driver sends the exact 64-bit value.
 */

import { describe, it, expect, vi } from "vitest";
import { getPlayerBySlug } from "../lib/player";
import { getDb } from "../lib/db";

vi.mock("../lib/db", () => ({ getDb: vi.fn() }));

// A realistic unique_rowid() value that exceeds MAX_SAFE_INTEGER.
// Number(BIG_ID) = 870_123_456_789_012_480  (differs by 135 — wrong row)
const BIG_ID = 870_123_456_789_012_345n;

describe("BigInt precision: Number.MAX_SAFE_INTEGER boundary", () => {
  it("confirms BIG_ID exceeds Number.MAX_SAFE_INTEGER", () => {
    expect(BIG_ID > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("confirms Number() loses precision on BIG_ID", () => {
    // If this test ever fails, the test value is too small and should be raised.
    expect(BigInt(Number(BIG_ID))).not.toBe(BIG_ID);
  });
});

describe("getPlayerBySlug — BigInt ID handling", () => {
  it("returns player data when the DB returns a large BigInt id", async () => {
    const playerRow = {
      id: BIG_ID,
      name: "Carlsen, Magnus",
      fide_id: 1503014,
      federation: "NOR",
      title: "GM",
      birth_year: 1990,
      death_year: null,
      total_games: 2500,
    };
    const fakeSql = vi.fn()
      .mockResolvedValueOnce([{ id: BIG_ID }]) // call 0: slug → id
      .mockResolvedValueOnce([playerRow]);       // call 1: id → full row
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(fakeSql);

    const result = await getPlayerBySlug("magnus-carlsen");

    expect(result).not.toBeNull();
    expect(result!.name).toBe("Carlsen, Magnus");
    expect(result!.federation).toBe("NOR");
    expect(result!.fide_id).toBe(1503014);
    expect(result!.birth_year).toBe(1990);
    expect(result!.title).toBe("GM");
  });

  it("passes BigInt directly to the second SQL call — not Number()", async () => {
    // This test catches the regression: if the code does Number(idRow[0].id),
    // the second SQL call receives a truncated float, not the exact BigInt.
    const fakeSql = vi.fn()
      .mockResolvedValueOnce([{ id: BIG_ID }])
      .mockResolvedValueOnce([{
        id: BIG_ID,
        name: "Test, Player",
        fide_id: null,
        federation: null,
        title: null,
        birth_year: null,
        death_year: null,
        total_games: 0,
      }]);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(fakeSql);

    await getPlayerBySlug("test-player");

    // Tagged-template call structure: fakeSql(stringsArray, ...interpolatedValues)
    // The second call (index 1) interpolates `id` at positions [1], [2], [3]
    // (player_a_id = ${id}, player_b_id = ${id}, WHERE p.id = ${id}).
    const secondCallArgs = fakeSql.mock.calls[1];
    const idPassedToQuery = secondCallArgs[1]; // first interpolated value

    // Must be BigInt — if it's a Number the precision bug is back.
    expect(typeof idPassedToQuery).toBe("bigint");
    expect(idPassedToQuery).toBe(BIG_ID);
  });

  it("all three id interpolations in the second query receive the same BigInt", async () => {
    const fakeSql = vi.fn()
      .mockResolvedValueOnce([{ id: BIG_ID }])
      .mockResolvedValueOnce([{
        id: BIG_ID, name: "X", fide_id: null, federation: null,
        title: null, birth_year: null, death_year: null, total_games: 0,
      }]);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(fakeSql);

    await getPlayerBySlug("x");

    const args = fakeSql.mock.calls[1]; // [strings, id, id, id]
    // positions 1, 2, 3 are the three ${id} interpolations
    expect(args[1]).toBe(BIG_ID);
    expect(args[2]).toBe(BIG_ID);
    expect(args[3]).toBe(BIG_ID);
  });

  it("returns null when slug not found (only one SQL call made)", async () => {
    const fakeSql = vi.fn().mockResolvedValueOnce([]);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(fakeSql);

    const result = await getPlayerBySlug("nobody-xyz-999");

    expect(result).toBeNull();
    // The data query should never run if slug lookup finds nothing.
    expect(fakeSql).toHaveBeenCalledTimes(1);
  });

  it("handles a FIDE-range id (safe integer — both BigInt and Number are fine)", async () => {
    // FIDE IDs fit in Number safely, so even the old code would work here.
    // This verifies the happy-path still works after the fix.
    const safeId = 1503014n;
    const fakeSql = vi.fn()
      .mockResolvedValueOnce([{ id: safeId }])
      .mockResolvedValueOnce([{
        id: safeId,
        name: "Carlsen, Magnus",
        fide_id: 1503014,
        federation: "NOR",
        title: "GM",
        birth_year: 1990,
        death_year: null,
        total_games: 2847,
      }]);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(fakeSql);

    const result = await getPlayerBySlug("magnus-carlsen");

    expect(result).not.toBeNull();
    expect(result!.fide_id).toBe(1503014);
    expect(result!.birth_year).toBe(1990);
  });

  it("handles player with no FIDE ID (null fide_id)", async () => {
    const fakeSql = vi.fn()
      .mockResolvedValueOnce([{ id: BIG_ID }])
      .mockResolvedValueOnce([{
        id: BIG_ID,
        name: "Historical, Player",
        fide_id: null,
        federation: null,
        title: null,
        birth_year: 1850,
        death_year: 1920,
        total_games: 42,
      }]);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(fakeSql);

    const result = await getPlayerBySlug("player-historical");

    expect(result).not.toBeNull();
    expect(result!.fide_id).toBeNull();
    expect(result!.birth_year).toBe(1850);
    expect(result!.death_year).toBe(1920);
  });
});
