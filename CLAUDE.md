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
npm test             # Run TypeScript unit tests (Vitest, no DB required)
pytest -q            # Run Python unit tests (no DB required; activate conda env first)

# Full ETL pipeline — Python (run in order for a fresh load):
python etl/download_twic.py                        # Download TWIC issues to data/pgn/
DATABASE_URL=... python etl/download_fide_xml.py   # Download FIDE XML → upsert ~541K players
node scripts/download-lumbrasgigabase.js           # Download Lumbras Gigabase OTB PGNs (no Python version yet)
DATABASE_URL=... python etl/batch_pairs.py         # Parse all PGNs, upsert opponent pairs (TRUNCATES first)
DATABASE_URL=... python etl/cleanup_data.py        # Remove dummy players (NN, Comp*, etc.)
DATABASE_URL=... python etl/set_historical_dates.py  # Populate birth/death years for ~50 key historical players
DATABASE_URL=... python etl/deduplicate_players.py   # Merge duplicate player rows (run with --dry-run first)
DATABASE_URL=... python etl/validate_data.py --fix   # Remove provably false cross-era links

# Incremental weekly update (also runs via GitHub Actions cron):
DATABASE_URL=... python etl/update_twic.py         # Download + upsert new TWIC issues only (no TRUNCATE)

# Utilities (JS, no Python equivalent yet):
node scripts/find-players.js          # Search PGN files for a player name
node scripts/add-player-fide.js <fide_id>  # Scrape FIDE calc page and add player + opponents to DB
```

## Recommended Full-Refresh Workflow
```bash
# Activate the Python conda environment first:
conda activate chess-distance-py

# 1. Download data
python etl/download_twic.py
DATABASE_URL=... python etl/download_fide_xml.py
node scripts/download-lumbrasgigabase.js   # (no Python version yet)

# 2. Reload all game pairs (reads data/pgnmentor/, data/pgn/, data/lumbrasgigabase/)
DATABASE_URL=... python etl/batch_pairs.py

# 3. Post-processing
DATABASE_URL=... python etl/cleanup_data.py
DATABASE_URL=... python etl/set_historical_dates.py
DATABASE_URL=... python etl/deduplicate_players.py
# IMPORTANT: always run validate_data after dedup — dedup can re-introduce false
# cross-era links by merging a historical duplicate into a modern canonical player.
DATABASE_URL=... python etl/validate_data.py --fix
```

## File Structure
- `app/` — Next.js App Router pages and API routes
- `lib/` — Shared TypeScript: `db.ts`, `bfs.ts`, `types.ts`, `federation-flag.ts`, `pgn-utils.ts`
- `components/` — React components: `PlayerSearch.tsx`, `DistanceResult.tsx`, `Stats.tsx`
- `etl/` — Python ETL pipeline (`batch_pairs.py`, `download_twic.py`, `download_fide_xml.py`, etc.)
- `py_lib/` — Python ports of TypeScript lib files (`bfs.py`, `types.py`)
- `scripts/` — Remaining utilities: `schema.sql`, `add-player-fide.js`, `download-lumbrasgigabase.js`, `find_players.py`, `list_data.py`
- `__tests__/` — TypeScript unit tests (Vitest, no DB required)
- `tests/` — Python unit tests (pytest, no DB required): `test_bfs.py`, `test_pgn_utils.py`, `test_deduplicate.py`
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

## Recent Updates (2026-03-04)

- **Tests added:** Added `__tests__/bfs.test.ts` covering `findShortestPathFromGraph` (same-node, no-path, simple path, chronological exclusion, time-control filter).
- **Test run:** Executed `npm test` — all tests passed (68 tests).
- **Process note:** Per project convention, this file will be updated to record repo changes whenever code or tests are modified.

## One-Site-Per-Player: Recommendation

- **Short answer:** Prefer a single Next.js site that exposes one canonical page per player (dynamic routes), rather than running separate websites per player.
- **Why (pros of per-player pages):** Good for SEO and shareability; simple URL structure (`/player/<slug-or-id>`); easy to reuse `components` and `lib` code; fits Next.js SSG/ISR model so popular pages can be pre-rendered while others are generated on demand.
- **Why not separate websites:** Managing, deploying, and securing millions of tiny sites is operationally expensive and unnecessary; harder to maintain cross-player features (search, BFS, global stats); duplicates infrastructure cost.
- **Scalability strategy:** Implement dynamic routes for player pages, pre-render high-traffic players with SSG/ISR, use server-side rendering or on-demand generation for the long tail, and provide an API for embedding or exporting player pages.
- **Optional features to prototype next:** per-player page scaffold (`app/player/[id]/page.tsx`), sitemap generation, or Elasticsearch-backed autocomplete for `players` search.

### Player page prototype (2026-03-04)

- Added `lib/player.ts` with `getPlayerData(id)` returning name, birth/death
  years, federation, FIDE ID, and aggregated total game count from the
  `opponents` table.
- Created dynamic route `app/player/[id]/page.tsx` rendering those fields and
  returning a 404 for invalid/missing IDs.
- Added unit tests (`__tests__/player.test.ts`) for the player data helper.
- This page is the basis for the requested per-player site similar to
  `https://www.csauthors.net/<name>`, with room to expand to opponents or
  additional stats.

If you'd like, I can prototype a per-player page scaffold or proceed with the Spark/Elasticsearch prototype you chose earlier.

## Python Prototype (2026-03-04)

- **Action:** Ported `lib/bfs.ts` logic to Python as `py_lib/bfs.py` and added `py_lib/types.py` types.
- **Tests:** Added `tests/test_bfs.py` (pytest) matching existing JS unit tests for BFS behavior.
- **How to run:** From the repo root, run the Python tests with `pytest -q` (requires Python 3.9+).

## Cross-platform Python environment

I added a Conda environment manifest `environment.yml` to make the Python prototype reproducible on Windows and Linux.

- **Create the environment (recommended with `mamba` or `conda`):**

  - Windows (PowerShell):

    ```powershell
    conda env create -f environment.yml
    conda activate chess-distance-py
    python -m pytest -q
    ```

  - Linux / macOS (bash):

    ```bash
    conda env create -f environment.yml
    conda activate chess-distance-py
    python -m pytest -q
    ```

- **If you don't have Conda:** install Miniconda or Miniforge (conda-forge build) for your platform. `mamba` (conda-forge) speeds environment creation: `mamba env create -f environment.yml`.

- **Notes:**
  - The `environment.yml` pins `python=3.10` and includes `pytest`, `asyncpg`, `python-chess`, `fastapi`, and related packages commonly needed for the ETL/API prototypes.
  
## Developer helpers

- I added two helper scripts to automate environment creation and test runs:
  - `scripts/run-python-tests.ps1` — PowerShell (Windows)
  - `scripts/run-python-tests.sh`  — Bash (Linux/macOS)

- Usage (PowerShell):

  ```powershell
  ./scripts/run-python-tests.ps1
  # skip creating the env if it already exists
  ./scripts/run-python-tests.ps1 -SkipCreate
  ```

- Usage (bash):

  ```bash
  ./scripts/run-python-tests.sh
  # skip creating the env if it already exists
  ./scripts/run-python-tests.sh --skip-create
  ```


