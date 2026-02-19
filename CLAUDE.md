# Chess Distance Calculator

## Project Overview
A web app that calculates the shortest "opponent path" between any two chess players, similar to CSauthors.net/distance but for chess. Built with Next.js, PostgreSQL (Neon serverless), deployed on Vercel.

## Tech Stack
- **Framework:** Next.js 16 with App Router, TypeScript, Tailwind CSS v4
- **Database:** PostgreSQL on Neon (serverless driver: `@neondatabase/serverless`)
- **Deployment:** Vercel (auto-deploys from GitHub `master`)
- **Data Sources:** PGN Mentor (217 historical player files) + TWIC archive (issues 920–1089)

## Architecture
- **Frontend:** React client components with autocomplete search and path visualization
- **API Routes:** `/api/search` (trigram fuzzy search), `/api/distance` (BFS shortest path), `/api/stats`, `/api/games`
- **BFS:** Bidirectional BFS in application code (`lib/bfs.ts`), adjacency list cached in-memory for 1h
- **ETL Pipeline:** `scripts/` — download PGN Mentor files + TWIC zips, parse, batch-insert into PostgreSQL

## Current Database State
- **88,060 players** (historical from 1850s + modern FIDE-rated players)
- **698,791 opponent pairs** from 1,068,273 games
- Morphy (1850s) is connected; Morphy → Carlsen distance = 6
- Dummy/computer players (NN, Comp*) have been removed to prevent false short-circuit paths

## Key Commands
```bash
npm run dev          # Start dev server (Turbopack)
npm run build        # Production build

# ETL scripts (run in order for a fresh load):
node scripts/load-historical.js   # Download pgnmentor + parse all PGNs (Phase 1+2)
node scripts/batch-pairs.js       # Fast batch-insert opponent pairs (~45 seconds for 720K pairs)
node scripts/cleanup-data.js      # Remove dummy players (NN, Comp*, etc.)

# Utilities:
node scripts/find-players.js      # Search PGN files for a player name
node scripts/validate-data.js     # Check for cross-era data anomalies
```

## Important Notes on Neon Driver
- Use **tagged template literals**: `sql\`SELECT ...\``
- For parameterized queries: `sql.query("SELECT $1", [value])` (NOT `sql("...", [...])`)
- `channel_binding=require` must NOT be in the DATABASE_URL on Vercel (causes connection failures)

## Environment Variables
- `DATABASE_URL` — Neon PostgreSQL connection string (in `.env.local`, gitignored)

## File Structure
- `app/` — Next.js App Router pages and API routes
- `lib/` — Shared code: database client (`db.ts`), BFS algorithm (`bfs.ts`), TypeScript types (`types.ts`)
- `components/` — React components: `PlayerSearch.tsx`, `DistanceResult.tsx`, `Stats.tsx`
- `scripts/` — ETL pipeline scripts and database schema (`schema.sql`)
- `data/` — Downloaded PGN files (gitignored)

## Database Schema
- `players` — id, name, fide_id (unique nullable), federation, title
- `opponents` — player_a_id, player_b_id (composite PK, a < b), game_count, first/last_game_date
- Trigram index on `players.name` for fuzzy search (`pg_trgm` extension)

## Style Guidelines
- Use Tailwind CSS utility classes with CSS custom properties for the chess color theme
- Components are client-side (`"use client"`) for interactivity
- Keep API routes thin — business logic in `lib/`
