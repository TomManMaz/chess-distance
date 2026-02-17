# Chess Distance Calculator

## Project Overview
A web app that calculates the shortest "opponent path" between any two chess players, similar to CSauthors.net/distance but for chess. Built with Next.js, PostgreSQL (Neon serverless), deployed on Vercel.

## Tech Stack
- **Framework:** Next.js 16 with App Router, TypeScript, Tailwind CSS v4
- **Database:** PostgreSQL on Neon (serverless driver: `@neondatabase/serverless`)
- **Deployment:** Vercel
- **Data Source:** TWIC archive PGN files (~2.9M FIDE-rated games)

## Architecture
- **Frontend:** React client components with autocomplete search and path visualization
- **API Routes:** `/api/search` (trigram fuzzy search), `/api/distance` (BFS shortest path), `/api/stats`
- **BFS:** Bidirectional BFS in application code (`lib/bfs.ts`), adjacency list cached in-memory
- **ETL Pipeline:** `scripts/` directory — download TWIC PGNs, parse headers, build player graph in PostgreSQL

## Key Commands
```bash
npm run dev          # Start dev server (Turbopack)
npm run build        # Production build
npm run etl          # Run full ETL pipeline (download + parse + build-graph)
npm run download-twic  # Download TWIC PGN zip files
npm run parse-pgn      # Parse PGN headers to JSONL
npm run build-graph    # Build graph in PostgreSQL from JSONL
```

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
