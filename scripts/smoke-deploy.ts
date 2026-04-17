/**
 * End-to-end smoke test for the deployed Chess Distance stack.
 *
 * Hits the real Railway FastAPI backend and Vercel frontend, exercising every
 * endpoint the UI depends on, plus the homepage HTML. Exits non-zero on any
 * failure so it can gate CI or a pre-deploy check.
 *
 * Usage (from repo root):
 *   npx tsx scripts/smoke-deploy.ts
 *   npx tsx scripts/smoke-deploy.ts --api=http://localhost:8001 --frontend=http://localhost:3000
 *
 * Environment overrides (CLI flags take precedence):
 *   SMOKE_API_BASE   — FastAPI base URL    (default: Railway prod)
 *   SMOKE_FRONTEND   — Vercel frontend URL (default: chess-distance.vercel.app)
 *
 * Exit codes: 0 = all pass, 1 = one or more checks failed.
 */

const DEFAULT_API_BASE = "https://chess-distance-api.fly.dev";
const DEFAULT_FRONTEND = "https://chess-distance.vercel.app";

// FIDE IDs of the two example players the homepage auto-loads on first render.
// These must stay in sync with app/page.tsx::tryExample().
const CARLSEN_FIDE = "1503014";
const KING_FIDE    = "400068";

// Per-check timeouts. The distance endpoint can cold-start for 12–26s while the
// graph loads, so give it the same 25s budget the backend itself enforces.
const DEFAULT_TIMEOUT_MS  = 10_000;
const DISTANCE_TIMEOUT_MS = 30_000;

type CheckResult = { name: string; ok: boolean; ms: number; detail: string };

function parseArgs(): { apiBase: string; frontend: string } {
  let apiBase  = process.env.SMOKE_API_BASE ?? DEFAULT_API_BASE;
  let frontend = process.env.SMOKE_FRONTEND ?? DEFAULT_FRONTEND;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--api="))      apiBase  = arg.slice(6);
    if (arg.startsWith("--frontend=")) frontend = arg.slice(11);
  }
  // Strip trailing slashes so we don't emit "//api/v2/…" later.
  return { apiBase: apiBase.replace(/\/$/, ""), frontend: frontend.replace(/\/$/, "") };
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url: string, timeoutMs: number): Promise<{ status: number; body: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return { status: res.status, body: await res.text() };
  } finally {
    clearTimeout(t);
  }
}

// Consumes an SSE stream until a "result" or "error" event arrives (or timeout).
async function consumeSSE(url: string, timeoutMs: number): Promise<{ event: string; data: unknown }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} (no body)`);
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        let ev = "message", data = "";
        for (const line of part.split("\n")) {
          if      (line.startsWith("event: ")) ev   = line.slice(7).trim();
          else if (line.startsWith("data: "))  data = line.slice(6);
        }
        if (ev === "result" || ev === "error") {
          try { return { event: ev, data: JSON.parse(data) }; }
          catch { return { event: ev, data }; }
        }
      }
    }
    throw new Error("stream closed without result or error event");
  } finally {
    clearTimeout(t);
  }
}

async function run(name: string, fn: () => Promise<string>): Promise<CheckResult> {
  const start = Date.now();
  try {
    const detail = await fn();
    return { name, ok: true, ms: Date.now() - start, detail };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name, ok: false, ms: Date.now() - start, detail: msg };
  }
}

async function main() {
  const { apiBase, frontend } = parseArgs();
  console.log(`Smoke test → api=${apiBase}  frontend=${frontend}\n`);

  const results: CheckResult[] = [];

  // ── 1. Health ─────────────────────────────────────────────────────────────
  results.push(await run("health", async () => {
    const data = await fetchJson(`${apiBase}/api/v2/health`, DEFAULT_TIMEOUT_MS) as { status?: string; graph_warm?: boolean };
    if (data.status !== "ok") throw new Error(`status=${data.status}`);
    return `status=ok graph_warm=${data.graph_warm}`;
  }));

  // ── 2. Stats (sanity-check DB connectivity + counts) ─────────────────────
  results.push(await run("stats", async () => {
    const s = await fetchJson(`${apiBase}/api/v2/stats`, DEFAULT_TIMEOUT_MS) as {
      total_players: number; total_opponent_pairs: number; total_games: number;
    };
    if (!s.total_players || s.total_players < 1000) throw new Error(`suspicious total_players=${s.total_players}`);
    if (!s.total_opponent_pairs)                    throw new Error("total_opponent_pairs is 0");
    return `${s.total_players.toLocaleString()} players · ${s.total_opponent_pairs.toLocaleString()} pairs · ${s.total_games.toLocaleString()} games`;
  }));

  // ── 3. Search by FIDE ID (Carlsen) ───────────────────────────────────────
  let carlsenDbId: number | null = null;
  results.push(await run("search carlsen (fide 1503014)", async () => {
    const rows = await fetchJson(`${apiBase}/api/v2/search?q=${CARLSEN_FIDE}`, DEFAULT_TIMEOUT_MS) as Array<{ id: number; name: string }>;
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("no results");
    const hit = rows.find(r => r.name.toLowerCase().includes("carlsen"));
    if (!hit) throw new Error(`Carlsen not in: ${rows.map(r => r.name).join(", ")}`);
    carlsenDbId = hit.id;
    return `${hit.name} (id=${hit.id})`;
  }));

  // ── 4. Search by FIDE ID (King, Daniel J) ────────────────────────────────
  let kingDbId: number | null = null;
  results.push(await run("search king (fide 400068)", async () => {
    const rows = await fetchJson(`${apiBase}/api/v2/search?q=${KING_FIDE}`, DEFAULT_TIMEOUT_MS) as Array<{ id: number; name: string }>;
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("no results");
    kingDbId = rows[0].id;
    return `${rows[0].name} (id=${rows[0].id})`;
  }));

  // ── 5. Fuzzy name search (exercises trigram path) ────────────────────────
  results.push(await run("search fuzzy 'carlsen'", async () => {
    const rows = await fetchJson(`${apiBase}/api/v2/search?q=carlsen`, DEFAULT_TIMEOUT_MS) as Array<{ name: string }>;
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("no results");
    return `${rows.length} hits, top=${rows[0].name}`;
  }));

  // ── 6. Distance SSE (the hot path) ───────────────────────────────────────
  results.push(await run("distance carlsen→king (SSE)", async () => {
    if (!carlsenDbId || !kingDbId) throw new Error("skipped: search didn't yield both ids");
    const { event, data } = await consumeSSE(
      `${apiBase}/api/v2/distance?from=${carlsenDbId}&to=${kingDbId}&tc=all`,
      DISTANCE_TIMEOUT_MS,
    );
    if (event === "error") throw new Error(`error event: ${JSON.stringify(data)}`);
    const res = data as { distance: number; path: Array<{ player: { name: string } }> };
    if (typeof res.distance !== "number") throw new Error(`no distance in result: ${JSON.stringify(data).slice(0, 200)}`);
    if (!Array.isArray(res.path) || res.path.length < 2) throw new Error("path too short");
    return `distance=${res.distance} path=${res.path.map(n => n.player.name).join(" → ")}`;
  }));

  // ── 7. Edge metadata (games endpoint, used by the detail modal) ─────────
  results.push(await run("games edge metadata", async () => {
    if (!carlsenDbId || !kingDbId) throw new Error("skipped: search didn't yield both ids");
    const data = await fetchJson(
      `${apiBase}/api/v2/games?a=${carlsenDbId}&b=${kingDbId}`,
      DEFAULT_TIMEOUT_MS,
    ) as { game_count?: number };
    // Carlsen/King may or may not be direct opponents (usually not) — 404 is
    // acceptable here as long as the endpoint responded. We only fail on a
    // connection error, which fetchJson already surfaces as a throw.
    return typeof data.game_count === "number" ? `direct games=${data.game_count}` : "no direct games (404 acceptable)";
  }));

  // ── 8. Frontend HTML (the Vercel side of the deploy) ─────────────────────
  results.push(await run("frontend HTML", async () => {
    const { status, body } = await fetchText(frontend, DEFAULT_TIMEOUT_MS);
    if (status !== 200) throw new Error(`HTTP ${status}`);
    if (!body.includes("Opponent distance computation")) {
      throw new Error("homepage title missing — may be serving a stale build");
    }
    return `200 OK, ${body.length.toLocaleString()} bytes`;
  }));

  // ── Report ───────────────────────────────────────────────────────────────
  const pad = Math.max(...results.map(r => r.name.length));
  for (const r of results) {
    const mark = r.ok ? "✓" : "✗";
    console.log(`  ${mark} ${r.name.padEnd(pad)}  ${String(r.ms).padStart(6)}ms  ${r.detail}`);
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log(`Failures:\n${failed.map(f => `  - ${f.name}: ${f.detail}`).join("\n")}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Smoke runner crashed:", err);
  process.exit(1);
});
