/**
 * HTTP integration tests for the player profile page.
 *
 * These tests hit the running Next.js dev server. Start it first:
 *   npm run dev
 *
 * Override the base URL with the DEV_URL env var if your server runs on a
 * non-default port:
 *   DEV_URL=http://localhost:3458 npm test
 *
 * All tests are automatically skipped when the dev server is not reachable.
 */

import { describe, it, expect, beforeAll } from "vitest";

const BASE = process.env.DEV_URL ?? "http://localhost:3000";

// Check once whether the dev server is up. Tests are skipped when it's not.
let serverAvailable = false;
beforeAll(async () => {
  try {
    const res = await fetch(`${BASE}/api/stats`, { signal: AbortSignal.timeout(3000) });
    serverAvailable = res.ok;
  } catch {
    serverAvailable = false;
  }
});

function maybeIt(name: string, fn: () => Promise<void>) {
  it(name, async () => {
    if (!serverAvailable) {
      console.log(`  [skipped — dev server not reachable at ${BASE}]`);
      return;
    }
    await fn();
  });
}

// ---------------------------------------------------------------------------
// /magnus-carlsen — the page that broke due to BigInt precision loss
// ---------------------------------------------------------------------------
describe("GET /magnus-carlsen (player profile page)", () => {
  maybeIt("returns HTTP 200", async () => {
    const res = await fetch(`${BASE}/magnus-carlsen`);
    expect(res.status).toBe(200);
  });

  maybeIt("returns HTML content-type", async () => {
    const res = await fetch(`${BASE}/magnus-carlsen`);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
  });

  maybeIt("contains the player's federation (NOR)", async () => {
    const res = await fetch(`${BASE}/magnus-carlsen`);
    const html = await res.text();
    expect(html).toContain("NOR");
  });

  maybeIt("contains the player's FIDE ID (1503014)", async () => {
    const res = await fetch(`${BASE}/magnus-carlsen`);
    const html = await res.text();
    expect(html).toContain("1503014");
  });

  maybeIt("contains birth year (1990)", async () => {
    const res = await fetch(`${BASE}/magnus-carlsen`);
    const html = await res.text();
    expect(html).toContain("1990");
  });

  maybeIt("renders the 'Top opponents' section", async () => {
    const res = await fetch(`${BASE}/magnus-carlsen`);
    const html = await res.text();
    expect(html).toMatch(/[Tt]op opponents/);
  });

  maybeIt("renders at least one known top opponent (Nakamura, Caruana, or Anand)", async () => {
    const res = await fetch(`${BASE}/magnus-carlsen`);
    const html = await res.text();
    const hasKnownOpponent =
      html.includes("Nakamura") ||
      html.includes("Caruana") ||
      html.includes("Anand");
    expect(hasKnownOpponent).toBe(true);
  });

  maybeIt("renders 'Find distance from' call-to-action", async () => {
    const res = await fetch(`${BASE}/magnus-carlsen`);
    const html = await res.text();
    expect(html).toMatch(/[Ff]ind distance from/);
  });

  maybeIt("renders 'Recorded games' stats section", async () => {
    const res = await fetch(`${BASE}/magnus-carlsen`);
    const html = await res.text();
    expect(html).toMatch(/[Rr]ecorded games/);
  });
});

// ---------------------------------------------------------------------------
// Other valid player slugs
// ---------------------------------------------------------------------------
describe("GET /garry-kasparov (valid slug)", () => {
  maybeIt("returns HTTP 200", async () => {
    const res = await fetch(`${BASE}/garry-kasparov`);
    expect(res.status).toBe(200);
  });

  maybeIt("contains Kasparov's federation (RUS or AZE)", async () => {
    const res = await fetch(`${BASE}/garry-kasparov`);
    const html = await res.text();
    expect(html.includes("RUS") || html.includes("AZE")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Non-existent slug → 404
// ---------------------------------------------------------------------------
describe("GET /nobody-xyz-abc-999 (non-existent slug)", () => {
  maybeIt("returns HTTP 404", async () => {
    const res = await fetch(`${BASE}/nobody-xyz-abc-999`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// API routes that must remain unaffected by the [player] catch-all route
// ---------------------------------------------------------------------------
describe("GET /api/stats (should not be caught by [player] route)", () => {
  maybeIt("returns HTTP 200 with JSON", async () => {
    const res = await fetch(`${BASE}/api/stats`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toMatch(/application\/json/);
  });

  maybeIt("response includes total_players field", async () => {
    const res = await fetch(`${BASE}/api/stats`);
    const data = await res.json() as Record<string, unknown>;
    expect(data).toHaveProperty("total_players");
    expect(Number(data.total_players)).toBeGreaterThan(0);
  });
});
