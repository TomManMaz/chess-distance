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
# IMPORTANT: always run as "python -m etl.<name>" from repo root (cross-platform)
python -m etl.download_twic                        # Download TWIC issues to data/pgn/
DATABASE_URL=... python -m etl.download_fide_xml   # Download FIDE XML → upsert ~541K players
node scripts/download-lumbrasgigabase.js           # Download Lumbras Gigabase OTB PGNs (no Python version yet)
DATABASE_URL=... python -m etl.batch_pairs         # Parse all PGNs, upsert opponent pairs (TRUNCATES first)
DATABASE_URL=... python -m etl.cleanup_data        # Remove dummy players (NN, Comp*, etc.)
DATABASE_URL=... python -m etl.set_historical_dates  # Populate birth/death years for ~50 key historical players
DATABASE_URL=... python -m etl.deduplicate_players   # Merge duplicate player rows (run with --dry-run first)
DATABASE_URL=... python -m etl.validate_data --fix   # Remove provably false cross-era links
DATABASE_URL=... python -m etl.add_slugs           # Populate slug column for player pages

# Incremental weekly update (also runs via GitHub Actions cron):
DATABASE_URL=... python -m etl.update_twic         # Download + upsert new TWIC issues only (no TRUNCATE)

# Utilities (JS, no Python equivalent yet):
node scripts/find-players.js          # Search PGN files for a player name
node scripts/add-player-fide.js <fide_id>  # Scrape FIDE calc page and add player + opponents to DB
```

## Recommended Full-Refresh Workflow
```bash
# Activate the Python conda environment first:
conda activate chess-distance-py

# 1. Download data
python -m etl.download_twic
DATABASE_URL=... python -m etl.download_fide_xml
node scripts/download-lumbrasgigabase.js   # (no Python version yet)

# 2. Reload all game pairs (reads data/pgnmentor/, data/pgn/, data/lumbrasgigabase/)
DATABASE_URL=... python -m etl.batch_pairs

# 3. Post-processing
DATABASE_URL=... python -m etl.cleanup_data
DATABASE_URL=... python -m etl.set_historical_dates
DATABASE_URL=... python -m etl.deduplicate_players
# IMPORTANT: always run validate_data after dedup — dedup can re-introduce false
# cross-era links by merging a historical duplicate into a modern canonical player.
DATABASE_URL=... python -m etl.validate_data --fix
DATABASE_URL=... python -m etl.add_slugs
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

## CSauthors-style Path Display (2026-03-04) — NEW

Enhanced the path visualization to match the compact, metadata-rich chain format of CSauthors.net/distance:

**What changed:**

1. **Enhanced PathNode type** (`lib/types.ts`):
   - Added optional fields: `first_game_date`, `last_game_date`, `classical_count`, `rapid_count`, `blitz_count`
   - Enables rich metadata display without extra API calls

2. **BFS now returns full edge metadata** (`lib/bfs.ts`):
   - Updated `AdjEntry` interface to include `rapidCount`, `blitzCount`, `firstGameDate`, `lastGameDate`
   - Database query fetches these fields (with graceful fallback for missing columns)
   - PathNode construction now includes all metadata per edge

3. **Redesigned path visualization** (`components/DistanceResult.tsx`):
   - **Inline chain display** (CSauthors style):
     - Shows: `[Player A] played [12 games] with [Player B] played [5 games] with [Player C]`
     - Game count appears in a prominent badge
   - **Time control tags** directly below game count:
     - Colored pills: `8 classical` (blue), `3 rapid` (orange), `2 blitz` (red)
   - **Date ranges** shown inline (if available from DB)
   - **Summary stats** on first load:
     - Total games across path
     - Total players in path
   - **Expandable "View game details"** section for full metadata modal

4. **Updated all unit tests** (`__tests__/bfs.test.ts`):
   - All `AdjEntry` mock objects updated with new fields
   - All 90 tests pass ✅

**Visual flow (user sees):**

```
Morphy and Carlsen are 8 opponents apart · hide path ▴
120 total games · 9 players

Morphy
played [12 games] with
8 classical 4 rapid 0 blitz
1850-06-15 – 1858-10-10
Anderssen
...
Carlsen
```

**Benefits:**

- ✅ Matches CSauthors' proven UX with game metadata inline
- ✅ No extra API calls (metadata pre-fetched in BFS result)
- ✅ Time control breakdown visible at a glance
- ✅ Date ranges help contextualize connections
- ✅ Expandable details modal available if user wants full game list

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

## Per-player and pair distance pages (2026-03-04)

CSAuthors-style shareable URLs implemented:

- **`/magnus-carlsen`** → player profile page (`app/[player]/page.tsx`)
- **`/magnus-carlsen/mihail-tal`** → pair distance page (`app/[player]/[playerB]/page.tsx`)
- Slug format: `"Carlsen, Magnus"` → `"magnus-carlsen"` (first-last, accents stripped)

### New / modified files
| File | Description |
|------|-------------|
| `lib/slug.ts` | `nameToSlug(name)` pure function (mirrors `etl/add_slugs.py`) |
| `lib/player.ts` | Added `getPlayerBySlug(slug)` + `title` field to `PlayerData` |
| `app/[player]/page.tsx` | Server-component player profile |
| `app/[player]/[playerB]/page.tsx` | Server-component pair distance page |
| `app/page.tsx` | `history.replaceState` to `/{slugA}/{slugB}` after calculation |
| `components/DistanceResult.tsx` | Player names link to `/{slug}` pages |
| `scripts/schema.sql` | `slug TEXT UNIQUE` column + `players_slug_idx` |
| `etl/add_slugs.py` | One-time script to populate `slug` for all existing players |
| `__tests__/slug.test.ts` | Unit tests for `nameToSlug` |

### ETL step needed (run after `batch_pairs.py`)
```bash
DATABASE_URL=... python -m etl.add_slugs
```
Also run after `deduplicate_players.py` since dedup renames rows.

### Performance notes
- `getTopNeighbors` uses UNION ALL (not CASE in JOIN) so each branch hits `idx_opponents_a` / `idx_opponents_b` indexes — avoids full table scan on Vercel
- `app/[player]/page.tsx` uses `React.cache()` to deduplicate `getPlayerBySlug` calls between `generateMetadata` and the page component (1 DB round-trip instead of 4)

### Route conflict analysis
- `/api/**` and `/player/**` are explicit segments → win over `[player]`
- `[player]` catches 1-segment paths not matched above
- `[player]/[playerB]` catches 2-segment paths

## Python Porting Strategy (2026-03-04 — Phase 1 Complete)

**Goal:** Make the Python ETL pipeline self-contained and enable future FastAPI backend.

### Phase 1 — Completed ✅

Four high-value modules ported. All syntax-validated, import-tested.

| Module | File | LOC | Status | Notes |
|--------|------|-----|--------|-------|
| **1. FIDE Scraper** | `py_lib/fide_scraper.py` | ~280 | ✅ | Async HTTP, parses FIDE rating pages, upserts players/opponents. Requires `aiohttp`, integrates with `psycopg` |
| **2. Slug Utilities** | `py_lib/slug.py` | ~70 | ✅ | Port of `lib/slug.ts`. `name_to_slug()`, `to_display_name()`, `slug_to_name_parts()`. Pure functions, no deps |
| **3. Federation Flags** | `py_lib/federation_flag.py` | ~130 | ✅ | Port of `lib/federation-flag.ts`. FIDE code → flag emoji ("USA" → "🇺🇸") |
| **4. Type System** | `py_lib/types.py` | ~180 | ✅ | Expanded from ~25 LOC. Dataclasses (internal) + optional Pydantic models (API validation) |
| **5. Enhanced DB Module** | `etl/db.py` | ~137 | ✅ | Expanded from ~35 LOC. Context managers, quick helpers, uniform error handling |

### Phase 2 — Remaining (Optional, ~3-4 weeks)

#### Medium effort (1-2 weeks):
- **Player Queries** (`py_lib/player.py`) — ~60 LOC
  - Port `getPlayerData(id)`, `getPlayerBySlug(slug)`, `getTopNeighbors()`
  - Direct SQL translation, same BigInt-safe patterns as ETL
  - Enables Python CLI tools and batch operations

- **FastAPI Backend** (`api/` directory) — ~400 LOC
  - Wrap 4 API routes (`/distance`, `/search`, `/stats`, `/games`)
  - Reuse BFS from `py_lib/bfs.py` (already ported)
  - PostgreSQL trigram search, time-control filtering
  - Async for concurrency; Docker-deployable alternative to Vercel

#### Lower priority (1 week):
- **Python Unit Tests**
  - `tests/test_slug.py` — `name_to_slug()` edge cases (accents, single-name figures, etc.)
  - `tests/test_federation_flag.py` — FIDE code validation
  - `tests/test_player_queries.py` — DB queries (with fixtures)

#### Not worth porting:
- React components (`components/`), Next.js pages (`app/`) — Keep TypeScript
- Full BFS + caching (`lib/bfs.ts`) — Already ported core algorithm; database caching is I/O-bound, consider as external service call
- TypeScript build/test infrastructure (Vitest, TypeScript compiler) — Specific to Next.js ecosystem

### Environment.yml Update Needed

To use FIDE scraper, add `aiohttp` to the Conda environment:

```yaml
# In environment.yml, add to dependencies:
- aiohttp >=3.9
```

Then recreate the environment:
```bash
conda env update -f environment.yml --prune
conda activate chess-distance-py
```

### Migration Path (if pursuing Phase 2)

**Option A: Incremental**
1. Add `py_lib/player.py` queries
2. Write Python CLI utilities (e.g., `scripts/search-players.py`)
3. Run tests against live DB (use read-only queries)

**Option B: Parallel API Backend**
1. Build FastAPI app in `api/` directory
2. Deploy alongside Vercel frontend (separate domain or `/api/v2/` prefix)
3. A/B test performance; migrate routes incrementally
4. Eventually sunset Next.js API routes once FastAPI is proven stable

**Option C: Full Replacement (Not recommended yet)**
- Keep Next.js frontend indefinitely (React is superior for UI)
- Move all backend to FastAPI (requires more DevOps effort)
- Benefits: Python-only ops, easier ML integration, better async scaling
- Costs: Lose Vercel convenience, manage Docker/Kubernetes, separate CI/CD for backend

### Known Gaps / Gotchas

1. **FIDE Scraper async model** — Currently uses `aiohttp` directly. To integrate with ETL (which uses `psycopg` sync), wrap it in a simple CLI:
   ```bash
   python -c "import asyncio; from py_lib.fide_scraper import scrape_fide_player; from etl.db import get_conn; 
   conn = get_conn(); asyncio.run(scrape_fide_player(1234, conn))"
   ```
   Better: Create `scripts/scrape-fide.py` wrapper.

2. **Pydantic optional** — `py_lib/types.py` gracefully degrades if `pydantic` is not installed (falls back to dataclasses). For API validation, add to `environment.yml`:
   ```yaml
   - pydantic >=2.0
   ```

3. **Type annotations** — Python's `from __future__ import annotations` ensures all hints are stringified (deferred evaluation), so no forward-reference issues. Matches TypeScript's experience.

4. **BigInt precision** — Python `int` is arbitrary-precision natively, so no conversion needed (unlike TypeScript's `Number` vs `BigInt` distinction). Safe to use DB IDs as dict keys directly.

### Testing Strategy

All new modules should have unit tests:
- **No DB required** — use fixtures for mock players/edges
- **Parametrized tests** — test slug generation with international names, empty values, etc.
- **Run:** `pytest -q tests/` from repo root

Example (tests/test_slug.py):
```python
import pytest
from py_lib.slug import name_to_slug

@pytest.mark.parametrize("name,expected", [
    ("Carlsen, Magnus", "carlsen-magnus"),
    ("Erdős, Pál", "erdos-pal"),
    ("Morphy", "morphy"),
    ("Nimzowitsch, Aaron ", "nimzowitsch-aaron"),  # trailing space
])
def test_name_to_slug(name, expected):
    assert name_to_slug(name) == expected
```

Then run:
```bash
pytest tests/test_slug.py -v
```


