/**
 * pgn-utils.test.ts
 *
 * Unit tests for the PGN parsing/ETL utilities in lib/pgn-utils.ts.
 * These functions are used by batch-pairs.js to process PGN files.
 * All tests are pure (no DB, no filesystem).
 */

import { describe, it, expect } from "vitest";
import { parseHeader, normalizeName, normalizeDate, classifyTimeControl } from "../lib/pgn-utils";

// ---------------------------------------------------------------------------
// parseHeader
// ---------------------------------------------------------------------------
describe("parseHeader", () => {
  it("parses a standard PGN header", () => {
    expect(parseHeader('[White "Carlsen, Magnus"]')).toEqual(["White", "Carlsen, Magnus"]);
  });

  it("parses FideId header", () => {
    expect(parseHeader('[WhiteFideId "1503014"]')).toEqual(["WhiteFideId", "1503014"]);
  });

  it("parses headers with special characters in value", () => {
    expect(parseHeader('[Event "89th Hastings Masters 2013-14"]')).toEqual([
      "Event",
      "89th Hastings Masters 2013-14",
    ]);
  });

  it("parses empty value", () => {
    expect(parseHeader('[TimeControl ""]')).toEqual(["TimeControl", ""]);
  });

  it("parses unknown/question-mark value", () => {
    expect(parseHeader('[Date "????.??.??"]')).toEqual(["Date", "????.??.??"]);
  });

  it("returns null for move text lines", () => {
    expect(parseHeader("1. e4 e5 2. Nf3")).toBeNull();
  });

  it("returns null for blank lines", () => {
    expect(parseHeader("")).toBeNull();
  });

  it("returns null for malformed headers (no quotes)", () => {
    expect(parseHeader("[White Carlsen]")).toBeNull();
  });

  it("returns null for partial headers", () => {
    expect(parseHeader('[White "Carlsen')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeName
// ---------------------------------------------------------------------------
describe("normalizeName", () => {
  it("leaves already-correct names unchanged", () => {
    expect(normalizeName("Carlsen, Magnus")).toBe("Carlsen, Magnus");
  });

  it("adds space after comma when missing", () => {
    expect(normalizeName("Gormally,D")).toBe("Gormally, D");
  });

  it("adds space after comma in multi-word first name", () => {
    expect(normalizeName("Mchedlishvili,M")).toBe("Mchedlishvili, M");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeName("  Carlsen, Magnus  ")).toBe("Carlsen, Magnus");
  });

  it("handles names without a comma (first-name-only style)", () => {
    expect(normalizeName("Magnus")).toBe("Magnus");
  });

  it("does not double-space when space already present", () => {
    expect(normalizeName("Jones, Michael")).toBe("Jones, Michael");
  });
});

// ---------------------------------------------------------------------------
// normalizeDate
// ---------------------------------------------------------------------------
describe("normalizeDate", () => {
  it("normalizes dot-separated PGN dates", () => {
    expect(normalizeDate("2024.03.15")).toBe("2024-03-15");
  });

  it("passes through already-hyphenated dates", () => {
    expect(normalizeDate("2024-03-15")).toBe("2024-03-15");
  });

  it("returns null for null input", () => {
    expect(normalizeDate(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(normalizeDate(undefined)).toBeNull();
  });

  it("returns null for question-mark placeholder", () => {
    expect(normalizeDate("????.??.??")).toBeNull();
  });

  it("returns null for partial dates", () => {
    expect(normalizeDate("2024.03.??")).toBeNull();
  });

  it("returns null for invalid calendar date (Feb 30)", () => {
    expect(normalizeDate("2024.02.30")).toBeNull();
  });

  it("returns null for invalid calendar date (Apr 31)", () => {
    expect(normalizeDate("2023.04.31")).toBeNull();
  });

  it("accepts Feb 29 in a leap year", () => {
    expect(normalizeDate("2024.02.29")).toBe("2024-02-29");
  });

  it("rejects Feb 29 in a non-leap year", () => {
    expect(normalizeDate("2023.02.29")).toBeNull();
  });

  it("accepts Dec 31", () => {
    expect(normalizeDate("2013.12.31")).toBe("2013-12-31");
  });

  it("returns null for month 00", () => {
    expect(normalizeDate("2024.00.15")).toBeNull();
  });

  it("returns null for month 13", () => {
    expect(normalizeDate("2024.13.01")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// classifyTimeControl
// ---------------------------------------------------------------------------
describe("classifyTimeControl", () => {
  // Classical
  it("treats missing time control as classical", () => {
    expect(classifyTimeControl(null, null)).toBe("classical");
    expect(classifyTimeControl("", null)).toBe("classical");
    expect(classifyTimeControl("?", null)).toBe("classical");
    expect(classifyTimeControl("-", null)).toBe("classical");
  });

  it("treats moves-per-time-period as classical (e.g. 40/7200)", () => {
    expect(classifyTimeControl("40/7200", null)).toBe("classical");
    expect(classifyTimeControl("40/5400+30", null)).toBe("classical");
  });

  it("treats 90+30 (90 min + 30s inc = 90+40×0.5 = 110 min) as classical", () => {
    // effectiveSecs = 90*60 + 40*30 = 5400 + 1200 = 6600 ≥ 1500
    expect(classifyTimeControl("5400+30", null)).toBe("classical");
  });

  it("treats 25+10 as classical (effectiveSecs = 1500 + 400 = 1900)", () => {
    // effectiveSecs = 1500 + 40*10 = 1500 + 400 = 1900 ≥ 1500
    expect(classifyTimeControl("1500+10", null)).toBe("classical");
  });

  // Rapid
  it("classifies 15+10 as rapid", () => {
    // effectiveSecs = 900 + 40*10 = 1300 ≥ 600
    expect(classifyTimeControl("900+10", null)).toBe("rapid");
  });

  it("classifies 10+0 as rapid", () => {
    // effectiveSecs = 600 ≥ 600
    expect(classifyTimeControl("600", null)).toBe("rapid");
  });

  // Blitz
  it("classifies 3+2 as blitz", () => {
    // effectiveSecs = 180 + 80 = 260 < 600
    expect(classifyTimeControl("180+2", null)).toBe("blitz");
  });

  it("classifies 5+0 as blitz", () => {
    // effectiveSecs = 300 < 600
    expect(classifyTimeControl("300", null)).toBe("blitz");
  });

  it("classifies 3+0 (Titled Tuesday) as blitz", () => {
    expect(classifyTimeControl("180", null)).toBe("blitz");
  });

  it("classifies 1+0 as blitz", () => {
    expect(classifyTimeControl("60", null)).toBe("blitz");
  });

  // Event name overrides
  it("classifies as blitz when event name contains 'blitz'", () => {
    expect(classifyTimeControl("5400+30", "Blitz Championship")).toBe("blitz");
  });

  it("classifies as blitz when event name contains 'bullet'", () => {
    expect(classifyTimeControl(null, "Bullet Arena")).toBe("blitz");
  });

  it("classifies as blitz for 'Titled Tuesday' events", () => {
    expect(classifyTimeControl("180", "Titled Tuesday blitz")).toBe("blitz");
    expect(classifyTimeControl(null, "Chess.com Titled Tuesday")).toBe("blitz");
  });

  it("classifies as rapid when event name contains 'rapid'", () => {
    expect(classifyTimeControl("5400+30", "World Rapid Championship")).toBe("rapid");
  });

  it("blitz event overrides classical time control", () => {
    // TC says classical but event says blitz → blitz wins
    expect(classifyTimeControl("5400+30", "Grand Prix Blitz")).toBe("blitz");
  });

  it("ignores '?' event name (not a real event)", () => {
    // Should fall through to TC-based classification
    expect(classifyTimeControl("300", "?")).toBe("blitz");
  });
});

// ---------------------------------------------------------------------------
// BigInt/Number Map key type safety (documents the CockroachDB INT8 hazard)
// ---------------------------------------------------------------------------
describe("BigInt vs Number Map key safety", () => {
  it("BigInt(x) !== Number(x) in Map keys (documents the original bug)", () => {
    const m = new Map<number | bigint, string>();
    m.set(BigInt(8603154), "player");
    // A Number lookup would miss a BigInt key — this was the bug
    expect(m.get(8603154)).toBeUndefined();
    expect(m.get(BigInt(8603154))).toBe("player");
  });

  it("Number(BigInt(x)) restores Map lookup (the fix)", () => {
    const m = new Map<number, string>();
    // Store with Number() conversion applied (the fix)
    m.set(Number(BigInt(8603154)), "player");
    // Number key lookup now works
    expect(m.get(8603154)).toBe("player");
    expect(m.get(Number(BigInt(8603154)))).toBe("player");
  });

  it("Number() conversion is safe for FIDE IDs (all < 10^7, well within MAX_SAFE_INTEGER)", () => {
    // FIDE IDs are at most 8 digits; Number.MAX_SAFE_INTEGER is ~9×10^15
    const maxFideId = 99_999_999; // 8 digits
    expect(Number(BigInt(maxFideId))).toBe(maxFideId);
    expect(Number.isSafeInteger(maxFideId)).toBe(true);
  });

  it("Number() is UNSAFE for CockroachDB unique_rowid() IDs (they exceed MAX_SAFE_INTEGER)", () => {
    // CockroachDB generates IDs like 875533614571806721 (19 digits)
    const cockroachId = BigInt("875533614571806721");
    // Exceeds MAX_SAFE_INTEGER — converting to Number loses precision
    expect(cockroachId > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    // Round-tripping through Number loses information
    expect(BigInt(Number(cockroachId))).not.toBe(cockroachId);
    // This is why player IDs must remain as BigInt for postgres.js params
  });
});
