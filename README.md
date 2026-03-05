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
- [Lumbra's Gigabase](https://lumbrasgigabase.com) — comprehensive OTB archive (~10 files, 10M+ games spanning 1800s–2025)
- [FIDE rating list XML](https://ratings.fide.com) — ~541K active rated players (used to pre-seed the player graph)

The database contains **~830K players** and **millions of opponent pairs** from over **10 million games**, spanning from Paul Morphy in the 1850s to the present.

**World champions coverage:** All classical world champions from Morphy to Ding Liren are in the database with verified birth/death years.

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
- Python 3.10+ with [Conda/Miniconda](https://docs.conda.io/en/latest/miniconda.html)
- A PostgreSQL-compatible database (e.g. [CockroachDB serverless](https://cockroachlabs.com) — free tier works)

### 1. Clone & Install

```bash
git clone https://github.com/TomManMaz/chess-distance.git
cd chess-distance
npm install

# Set up Python environment
conda env create -f environment.yml
conda activate chess-distance-py
```

### 2. Configure Environment

```bash
# Create .env.local with your database connection string
echo 'DATABASE_URL=postgresql://user:pass@host:26257/defaultdb?sslmode=verify-full' > .env.local
```

### 3. Set Up the Database Schema

```bash
# Apply schema (players, opponents tables + indexes)
DATABASE_URL=... node -e "
  const postgres = require('postgres');
  const fs = require('fs');
  const sql = postgres(process.env.DATABASE_URL);
  sql.unsafe(fs.readFileSync('scripts/schema.sql','utf8')).then(() => { console.log('Done'); sql.end(); });
"
```

### 4. Load Game Data (full ETL pipeline)

```bash
conda activate chess-distance-py

# 1. Download data sources
python -m etl.download_twic                        # TWIC weekly PGN archives
DATABASE_URL=... python -m etl.download_fide_xml   # FIDE player list (titles, birth years)
node scripts/download-lumbrasgigabase.js           # Lumbra's Gigabase OTB archives (~10 GB)

# 2. Parse all PGNs and build the opponent graph
DATABASE_URL=... python -m etl.batch_pairs

# 3. Clean up and enrich
DATABASE_URL=... python -m etl.cleanup_data          # remove computer/dummy players
DATABASE_URL=... python -m etl.set_historical_dates  # birth/death years for ~120 historical players
DATABASE_URL=... python -m etl.deduplicate_players   # merge abbreviated name duplicates
DATABASE_URL=... python -m etl.validate_data --fix   # remove provably false cross-era links
DATABASE_URL=... python -m etl.add_slugs             # populate URL slugs for player pages
```

> **Note:** Full data loading takes 1–3 hours depending on hardware and network speed. The dev server runs without game data — search returns no results but the UI works.

### 5. Start Dev Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Automatic Weekly Updates

A GitHub Actions workflow (`.github/workflows/twic-update.yml`) runs every Tuesday to download new TWIC issues and add them to the database **without a full reload**.

To enable it:
1. Go to your GitHub repo → **Settings → Secrets and variables → Actions**
2. Add a secret named `DATABASE_URL` with your CockroachDB connection string
3. Trigger manually via **Actions → Weekly TWIC Update → Run workflow** to test

---

## Project Structure

```
app/                      Next.js pages and API routes
  [player]/page.tsx       Per-player profile page (e.g. /magnus-carlsen)
  [player]/[playerB]/     Pair distance page (e.g. /magnus-carlsen/garry-kasparov)
  api/distance/           BFS pathfinding endpoint
  api/search/             Fuzzy player name search (trigram)
  api/games/              Game detail lookup
  api/stats/              Database statistics

lib/
  bfs.ts                  Bidirectional BFS + adjacency list cache
  player.ts               Player data queries (profile pages)
  slug.ts                 Name ↔ URL slug conversion
  pgn-utils.ts            Pure ETL utilities (parseHeader, normalizeName, etc.)
  types.ts                TypeScript interfaces
  db.ts                   Database connection (postgres.js)
  federation-flag.ts      Federation code → emoji flag

components/
  PlayerSearch.tsx        Autocomplete search box
  DistanceResult.tsx      Path visualization (CSauthors-style chain display)
  Stats.tsx               Database statistics
  Footer.tsx              Site footer

etl/                      Python ETL pipeline
  batch_pairs.py          Core ETL: parse all PGNs, upsert opponent pairs
  download_twic.py        Download TWIC issues
  download_fide_xml.py    Download + upsert FIDE XML
  cleanup_data.py         Remove dummy/computer players
  set_historical_dates.py Birth/death years for ~120 historical players
  deduplicate_players.py  Merge abbreviated name duplicates
  validate_data.py        Remove provably false cross-era links
  add_slugs.py            Populate URL slugs
  update_twic.py          Incremental weekly TWIC update
  verify_chain.py         Verify world champion connectivity chain

scripts/
  schema.sql              Database schema
  download-lumbrasgigabase.js
  benchmark-distance.ts   Time cold-start graph load vs warm BFS

__tests__/                TypeScript unit tests (Vitest, no DB required)
tests/                    Python unit tests (pytest, no DB required)
```

---

## Running Tests

```bash
npm test       # TypeScript tests (Vitest) — no database required, runs in <1s
pytest -q      # Python tests — no database required
```

---

## Performance Notes

- **Cold start:** ~12–26 seconds (full graph load from DB into memory on Vercel serverless)
- **Warm BFS:** < 1 ms (cached graph, once loaded)
- The in-memory graph cache has a 1-hour TTL. Vercel function instances share the cache while warm.

---

## License

MIT
