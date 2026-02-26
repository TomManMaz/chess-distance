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
- [PGN Mentor](https://www.pgnmentor.com) — 217 historical player files, including 19th-century masters
- [TWIC](https://theweekinchess.com) (The Week In Chess) — weekly PGN archives from issue 920 to present
- [FIDE rating list XML](https://ratings.fide.com) — ~400K active rated players

The database contains **~70,000 players** and **~940,000 opponent pairs** from roughly **1.6 million games**, spanning from Paul Morphy in the 1850s to the current week.

**Chronological integrity:** The BFS filters out edges where players' lifespans provably don't overlap — preventing false shortcuts created by historical players sharing a name with modern ones.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js 16](https://nextjs.org) (App Router, TypeScript) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) |
| Database | [Neon](https://neon.tech) serverless PostgreSQL |
| Deployment | [Vercel](https://vercel.com) (auto-deploy from `master`) |
| Pathfinding | Bidirectional BFS, in-memory adjacency list (1h TTL cache) |

---

## Local Development

### Prerequisites

- Node.js 20+
- A free PostgreSQL database at [neon.tech](https://neon.tech)

### 1. Clone & Install

```bash
git clone https://github.com/your-username/chess-distance.git
cd chess-distance
npm install
```

### 2. Configure Environment

```bash
cp .env.local.example .env.local
# Edit .env.local and set DATABASE_URL to your Neon connection string
# Remove &channel_binding=require if present — it breaks Vercel
```

### 3. Set Up the Database

Run migrations to create the schema and add required columns:

```bash
node scripts/migrate-add-time-controls.js
node scripts/migrate-add-birth-death-years.js
```

### 4. Load Game Data

```bash
# Download historical PGN files from PGN Mentor
node scripts/load-historical.js

# Download TWIC archives (weekly PGN files)
node scripts/download-twic.js

# Download FIDE player list (birth years, titles, federations)
DATABASE_URL=... node scripts/download-fide-xml.js

# Build the opponent graph
DATABASE_URL=... node scripts/batch-pairs.js

# Clean up dummy/computer players
DATABASE_URL=... node scripts/cleanup-data.js

# Set birth/death years for historical players
DATABASE_URL=... node scripts/set-historical-dates.js

# Merge abbreviated duplicate names (e.g. "Kasparov, G" → "Kasparov, Garry")
DATABASE_URL=... node scripts/deduplicate-players.js

# Verify no cross-era data anomalies
DATABASE_URL=... node scripts/validate-data.js --fix
```

> **Note:** Full data loading takes 20–40 minutes. The dev server works without game data — search will return no results but the app runs.

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
2. Add a secret named `DATABASE_URL` with your Neon connection string (without `&channel_binding=require`)
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
  types.ts         TypeScript interfaces
  db.ts            Neon database connection

components/
  PlayerSearch.tsx  Autocomplete search box
  DistanceResult.tsx Path visualization with game details

scripts/           ETL pipeline and database utilities
```

---

## License

MIT
