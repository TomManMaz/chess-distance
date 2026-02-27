# Chess Distance Calculator

## Project Overview
A web app that calculates the shortest "opponent path" between any two chess players, similar to CSauthors.net/distance but for chess. Built with Next.js, PostgreSQL (Neon serverless), deployed on Vercel.

## Tech Stack
- **Framework:** Next.js 16 with App Router, TypeScript, Tailwind CSS v4
- **Database:** PostgreSQL on Neon (serverless driver: `@neondatabase/serverless`)
- **Deployment:** Vercel (auto-deploys from GitHub `master`)
- **Data Sources:** PGN Mentor (217 historical player files) + TWIC archive (issues 920–1089) + FIDE rating list XML

## Architecture
- **Frontend:** React client components with autocomplete search and path visualization
- **API Routes:** `/api/search` (trigram fuzzy search), `/api/distance` (BFS shortest path + `?tc=classical` filter), `/api/stats`, `/api/games`
- **BFS:** Bidirectional BFS in application code (`lib/bfs.ts`), adjacency list cached in-memory for 1h; supports classical-only filter via `classical_count` edge weight
- **ETL Pipeline:** `scripts/` — download PGN Mentor files + TWIC zips + FIDE XML, parse, batch-insert into PostgreSQL

## Current Database State
- **~70,000–76,000 players** (historical from 1850s + modern FIDE-rated players)
- **~939,000 opponent pairs** from ~1,616,000 games (TWIC 920–1633 + PGN Mentor)
- Morphy (1850s) is connected; Morphy → Carlsen distance = 8 (via real historical chain through Anderssen)
- Dummy/computer players (NN, Comp*) have been removed to prevent false short-circuit paths
- **Mannelli Mazzoli, Tommaso** (FIDE 2842411) is in the DB with Morphy number = 8 (7 connections from Oct 2023 tournament, all classical)
- False Morphy–Knott link removed: Simon JB Knott (b.1958) cannot have played Morphy (d.1884)
- `opponents` table has `classical_count`, `rapid_count`, `blitz_count`, `event_sample` columns (added by migration script)
- ~95% of opponent pairs have `classical_count > 0` — classical-only filter works well

## Key Commands
```bash
npm run dev          # Start dev server (Turbopack)
npm run build        # Production build

# Full ETL pipeline (run in order for a fresh load):
node scripts/load-historical.js       # Download PGN Mentor + parse all PGNs (Phase 1+2)
node scripts/batch-pairs.js           # Fast batch-insert opponent pairs
node scripts/cleanup-data.js          # Remove dummy players (NN, Comp*, etc.)

# New data sources:
node scripts/download-twic.js         # Download TWIC issues 1090–latest to data/pgn/
                                      # then run batch-pairs.js to load them
node scripts/download-fide-xml.js     # Download FIDE rating list XML → upsert all ~400K players

# One-time migrations (run once against live DB):
node scripts/migrate-add-time-controls.js        # Add classical_count, rapid_count, blitz_count, event_sample columns
node scripts/migrate-add-birth-death-years.js    # Add birth_year, death_year columns
node scripts/migrate-add-indexes.js              # Add partial indexes on players(birth_year/death_year)
node scripts/migrate-add-bfs-function.js         # Install find_chess_path() PL/pgSQL function in DB
node scripts/set-historical-dates.js             # Populate birth/death years for ~50 key historical players
node scripts/deduplicate-players.js              # Merge duplicate player rows (run with --dry-run first)
node scripts/deduplicate-players.js --dry-run

npm test                                         # Run unit tests (Vitest, no DB required)

# Utilities:
node scripts/find-players.js          # Search PGN files for a player name
node scripts/validate-data.js         # Check for cross-era data anomalies
node scripts/add-player-fide.js <fide_id>  # Scrape FIDE calc page and add player + opponents to DB
node scripts/my-morphy-number.js      # Compute Morphy number for Mannelli Mazzoli, Tommaso
```

## Recommended full-refresh workflow
```bash
# 1. Download new data
node scripts/download-twic.js
DATABASE_URL=... node scripts/download-fide-xml.js

# 2. Reload all game pairs (reads all PGNs in data/pgnmentor/ and data/pgn/)
DATABASE_URL=... node scripts/batch-pairs.js

# 3. Clean up
DATABASE_URL=... node scripts/cleanup-data.js
DATABASE_URL=... node scripts/deduplicate-players.js
# IMPORTANT: always run validate-data after dedup — dedup can re-introduce false
# cross-era links by merging a historical duplicate into a modern canonical player.
DATABASE_URL=... node scripts/validate-data.js --fix
```

## Important Notes on Neon Driver
- Use **tagged template literals**: `sql\`SELECT ...\``
- For parameterized queries: `sql.query("SELECT $1", [value])` (NOT `sql("...", [...])`)
- `channel_binding=require` must NOT be in the DATABASE_URL on Vercel (causes connection failures)

## Environment Variables
- `DATABASE_URL` — Neon PostgreSQL connection string (in `.env.local`, gitignored)

## File Structure
- `app/` — Next.js App Router pages and API routes
- `lib/` — Shared code: `db.ts`, `bfs.ts`, `types.ts`, `federation-flag.ts`
- `components/` — React components: `PlayerSearch.tsx`, `DistanceResult.tsx`, `Stats.tsx`
- `scripts/` — ETL pipeline scripts and database schema (`schema.sql`)
- `data/` — Downloaded PGN files (gitignored)

## Database Schema
- `players` — id, name, fide_id (unique nullable), federation, title, birth_year, death_year
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

## Style Guidelines
- Use Tailwind CSS utility classes with CSS custom properties for the chess color theme
- Components are client-side (`"use client"`) for interactivity
- Keep API routes thin — business logic in `lib/`
