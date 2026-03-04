# Chess Distance Calculator

**How many degrees of separation are there between any two chess players?**

Like the [Erdős number](https://en.wikipedia.org/wiki/Erd%C5%91s_number) for mathematicians, or [Six Degrees of Kevin Bacon](https://en.wikipedia.org/wiki/Six_Degrees_of_Kevin_Bacon) for actors — but for chess. Two players are connected if they've played a game against each other.

- **Distance 0** — same player
- **Distance 1** — they played each other directly
- **Distance 2** — they both played some third player C
- **Distance N** — shortest chain of opponents linking them

For example: **Magnus Carlsen → Morphy distance = 8**, via a real historical chain going back to the 1850s.

---

## How It Works

The app builds a graph where nodes are players and edges connect players who have faced each other over the board. It then finds the shortest path using **bidirectional BFS**.

**Data sources:**
- [PGN Mentor](https://www.pgnmentor.com) — 199 curated player files covering historical and top modern players
- [TWIC](https://theweekinchess.com) (The Week In Chess) — weekly PGN archives from issue 920 to present
- [Lumbra's Gigabase](https://www.lumbras.com) — comprehensive OTB game archive (~13 files, 10M+ games spanning 1800s–2025)
- [FIDE rating list XML](https://ratings.fide.com) — ~541K active rated players (used to pre-seed the player graph)

The database contains **~830K players** and **millions of opponent pairs** from over **10 million games**, spanning from Paul Morphy in the 1850s to the present.

**Chronological integrity:** The BFS filters out edges where players' lifespans provably don't overlap — preventing false shortcuts created by historical players sharing a name with modern ones.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js 16](https://nextjs.org) (App Router, TypeScript) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) |
| Database | [CockroachDB](https://cockroachlabs.com) (serverless, postgres-compatible) |
| ORM / Driver | [postgres.js](https://github.com/porsager/postgres) (`postgres` npm package) |
| Deployment | [Vercel](https://vercel.com) (auto-deploy from `master`) |
| Pathfinding | Bidirectional BFS, in-memory adjacency list (1h TTL cache) |

---

## Local Development

### Prerequisites

- Node.js 20+
- A PostgreSQL-compatible database (e.g. [CockroachDB serverless](https://cockroachlabs.com) — free tier works)

### 1. Clone & Install

```bash
git clone https://github.com/your-username/chess-distance.git
cd chess-distance
npm install
```

### 2. Configure Environment

```bash
cp .env.local.example .env.local
# Edit .env.local and set DATABASE_URL to your CockroachDB (or PostgreSQL) connection string
```

### 3. Set Up the Database

```bash
# Create the schema (players, opponents tables + indexes)
DATABASE_URL=... node -e "
  const postgres = require('postgres');
  const fs = require('fs');
  const sql = postgres(process.env.DATABASE_URL);
  sql.unsafe(fs.readFileSync('scripts/schema.sql','utf8')).then(() => { console.log('Done'); sql.end(); });
"
```

### 4. Load Game Data

Run the full ETL pipeline in order:

```bash
# 1. Download data
node scripts/download-twic.js                      # TWIC weekly PGN archives
DATABASE_URL=... node scripts/download-fide-xml.js # FIDE player list (birth years, titles)
# Optional: Lumbra's Gigabase (~10 GB, most comprehensive)
node scripts/download-lumbrasgigabase.js           # all time ranges (Windows-compatible)

# 2. Build the opponent graph (reads data/pgnmentor/, data/pgn/, data/lumbrasgigabase/)
DATABASE_URL=... node scripts/batch-pairs.js

# 3. Clean up and deduplicate
DATABASE_URL=... node scripts/cleanup-data.js        # remove computer/dummy players
DATABASE_URL=... node scripts/deduplicate-players.js # merge abbreviated name duplicates
DATABASE_URL=... node scripts/set-historical-dates.js # birth/death years for ~50 historical players
DATABASE_URL=... node scripts/validate-data.js --fix  # remove provably false cross-era links
```

> **Note:** Full data loading takes 1–3 hours depending on data sources. The dev server works without game data — search returns no results but the app runs.

### 5. Start Dev Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Automatic Weekly Updates

A GitHub Actions workflow (`.github/workflows/twic-update.yml`) runs every Tuesday to download new TWIC issues and add them to the database **without a full reload**. It uses an incremental upsert strategy — no `TRUNCATE`, no downtime.

To enable it:
1. Go to your GitHub repo → **Settings → Secrets and variables → Actions**
2. Add a secret named `DATABASE_URL` with your CockroachDB connection string
3. Trigger manually via **Actions → Weekly TWIC Update → Run workflow** to test

---

## Project Structure

```
app/               Next.js pages and API routes
  api/distance/    BFS pathfinding endpoint
  api/search/      Fuzzy player name search (trigram)
  api/games/       Game detail lookup
  api/stats/       Database statistics

lib/
  bfs.ts           Bidirectional BFS + adjacency list cache
  pgn-utils.ts     Pure ETL utilities (parseHeader, normalizeName, normalizeDate, classifyTimeControl)
  types.ts         TypeScript interfaces
  db.ts            Database connection (postgres.js)
  federation-flag.ts  Federation → emoji flag lookup

components/
  PlayerSearch.tsx   Autocomplete search box
  DistanceResult.tsx Path visualization with game details
  Stats.tsx          Database statistics display

__tests__/
  chronological.test.ts  BFS chronological edge filtering
  pgn-utils.test.ts      PGN parsing utility functions

scripts/           ETL pipeline and database utilities
  schema.sql       Database schema
  batch-pairs.js   Core ETL: parse all PGNs, upsert opponent pairs
  download-twic.js, download-fide-xml.js, download-lumbrasgigabase.js
  cleanup-data.js, deduplicate-players.js, validate-data.js, ...
```

---

## Running Tests

```bash
npm test   # Vitest — no database required, runs in <1s
```

---

## License

MIT
