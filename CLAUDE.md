# Chess Distance Calculator

## Project Overview
A web app that calculates the shortest "opponent path" between any two chess players, similar to CSauthors.net/distance but for chess. Built with Next.js, PostgreSQL (CockroachDB), deployed on Vercel.

## Tech Stack
- **Framework:** Next.js 16 with App Router, TypeScript, Tailwind CSS v4
- **Database:** CockroachDB serverless (postgres-compatible, driver: `postgres` npm package)
- **Deployment:** Vercel (auto-deploys from GitHub `master`)
- **Data Sources:** PGN Mentor (199 player files) + TWIC archive (issues 920–1633+) + Lumbra's Gigabase (13 OTB PGN archives, ~10M+ games) + FIDE rating list XML (~541K players)

## Architecture
- **Frontend:** React client components with autocomplete search and path visualization
- **API Routes:** `/api/search` (trigram fuzzy search), `/api/distance` (BFS shortest path + `?tc=classical` filter), `/api/stats`, `/api/games`
- **BFS:** Bidirectional BFS in application code (`lib/bfs.ts`), adjacency list cached in-memory for 1h; supports classical-only filter via `classical_count` edge weight
- **ETL Pipeline:** `scripts/` — download PGN Mentor files + TWIC zips + FIDE XML + Lumbras Gigabase, parse, batch-insert into CockroachDB

## Current Database State
- **~832K players** (FIDE XML provides bulk; historical from 1850s + modern FIDE-rated players)
- **Millions of opponent pairs** — TWIC 920–1633 + PGN Mentor + Lumbras Gigabase (full rebuild in progress as of 2026-03-04 with BigInt fix)
- Morphy (1850s) is connected; Morphy → Carlsen distance = 8 (via real historical chain through Anderssen)
- Dummy/computer players (NN, Comp*) removed via `cleanup-data.js`
- `opponents` table has `classical_count`, `rapid_count`, `blitz_count`, `event_sample` columns
- `players` table has `birth_year`, `death_year` columns

## CockroachDB Driver Notes
- Driver: `postgres` npm package (postgres.js v3+)
- Use **tagged template literals**: `` sql`SELECT ...` ``
- For raw parameterized queries: `sql.unsafe("SELECT $1", [value])`
- **CRITICAL — BigInt type hazard:** CockroachDB returns ALL integer columns (INT8) as JavaScript `BigInt` via postgres.js. Player `id` (unique_rowid, ~19 digits) MUST stay as BigInt — converting to `Number()` loses precision and causes foreign key violations. FIDE IDs (≤8 digits) are safe to convert with `Number()` for use as Map keys. Pattern used in batch-pairs.js:
  ```js
  fideToId.set(Number(p.fide_id), p.id)  // Number key, BigInt value
  nameToId.set(p.name.toLowerCase(), p.id) // string key, BigInt value
  ```
- `channel_binding=require` must NOT be in the DATABASE_URL (causes connection failures)

## Environment Variables
- `DATABASE_URL` — CockroachDB connection string (in `.env.local`, gitignored)
  - Format: `postgresql://user:pass@host:26257/defaultdb?sslmode=verify-full`

## Key Commands
```bash
npm run dev          # Start dev server (Turbopack)
npm run build        # Production build
npm test             # Run unit tests (Vitest, no DB required)

# Full ETL pipeline (run in order for a fresh load):
node scripts/download-twic.js                       # Download TWIC issues to data/pgn/
DATABASE_URL=... node scripts/download-fide-xml.js  # Download FIDE XML → upsert ~541K players
node scripts/download-lumbrasgigabase.js            # Download Lumbras Gigabase OTB PGNs
                                                    # (Windows: uses megajs, no megatools needed)
DATABASE_URL=... node scripts/batch-pairs.js        # Parse all PGNs, upsert opponent pairs (TRUNCATES first)
DATABASE_URL=... node scripts/cleanup-data.js       # Remove dummy players (NN, Comp*, etc.)
DATABASE_URL=... node scripts/set-historical-dates.js # Populate birth/death years for ~50 key historical players
DATABASE_URL=... node scripts/deduplicate-players.js  # Merge duplicate player rows (run with --dry-run first)
DATABASE_URL=... node scripts/validate-data.js --fix  # Remove provably false cross-era links

# Utilities:
node scripts/find-players.js          # Search PGN files for a player name
node scripts/add-player-fide.js <fide_id>  # Scrape FIDE calc page and add player + opponents to DB
node scripts/my-morphy-number.js      # Compute Morphy number for Mannelli Mazzoli, Tommaso
```

## Recommended Full-Refresh Workflow
```bash
# 1. Download data
node scripts/download-twic.js
DATABASE_URL=... node scripts/download-fide-xml.js
node scripts/download-lumbrasgigabase.js

# 2. Reload all game pairs (reads data/pgnmentor/, data/pgn/, data/lumbrasgigabase/)
DATABASE_URL=... node scripts/batch-pairs.js

# 3. Post-processing
DATABASE_URL=... node scripts/cleanup-data.js
DATABASE_URL=... node scripts/set-historical-dates.js
DATABASE_URL=... node scripts/deduplicate-players.js
# IMPORTANT: always run validate-data after dedup — dedup can re-introduce false
# cross-era links by merging a historical duplicate into a modern canonical player.
DATABASE_URL=... node scripts/validate-data.js --fix
```

## File Structure
- `app/` — Next.js App Router pages and API routes
- `lib/` — Shared code: `db.ts`, `bfs.ts`, `types.ts`, `federation-flag.ts`, `pgn-utils.ts`
- `components/` — React components: `PlayerSearch.tsx`, `DistanceResult.tsx`, `Stats.tsx`
- `scripts/` — ETL pipeline scripts and database schema (`schema.sql`)
- `__tests__/` — Vitest unit tests (no DB required)
- `data/` — Downloaded PGN files (gitignored)

## Database Schema
- `players` — id (SERIAL/INT8), name, fide_id (unique nullable INT), federation, title, birth_year, death_year
- `opponents` — player_a_id, player_b_id (composite PK, a < b), game_count, first/last_game_date, classical_count, rapid_count, blitz_count, event_sample
- `settings` — key, value (used by update-twic.js to track last_twic_issue)
- Trigram index on `players.name` for fuzzy search (`pg_trgm` extension)

## Chronological Edge Filter (bfs.ts)
The BFS adjacency list skips edges where player lifespans provably don't overlap:
- If player A's `death_year < player B's `birth_year` → skip (A died before B was born)
- If player B's `death_year < player A's `birth_year` → skip
- Only applied when both players have the relevant birth/death data
- Historical death years are hardcoded via `set-historical-dates.js`
- Modern birth years come from FIDE XML (`download-fide-xml.js`)

## Historical Player Names in DB (verified)
- "Morphy, Paul", "Steinitz, William", "Zukertort, Johannes Hermann", "Janowsky, Dawid Markelowicz"
- "Marshall, Frank James", "Nimzowitsch, Aaron " (trailing space — preserved), "Bogoljubow, Efim"
- "Tartakower, Saviely" (one 'l'), "Reshevsky, Samuel Herman", "Geller, Efim P"
- "Tal, Mihail" (not Mikhail), "Petrosian, Tigran V", "Bronstein, David I"

## Style Guidelines
- Use Tailwind CSS utility classes with CSS custom properties for the chess color theme
- Components are client-side (`"use client"`) for interactivity
- Keep API routes thin — business logic in `lib/`
- Pure ETL utility functions (parseHeader, normalizeName, normalizeDate, classifyTimeControl) live in `lib/pgn-utils.ts` and are covered by unit tests
