-- =============================================================================
-- Chess Distance Calculator — Database Schema
-- =============================================================================
-- Two tables: players (graph nodes) and opponents (graph edges).
-- The BFS in lib/bfs.ts reads both tables to build an in-memory adjacency list.
--
-- Database: CockroachDB (postgres-compatible). Run once on a fresh DB.
-- Driver:   postgres.js (npm: postgres). Returns INT8 columns as BigInt.
--
-- IMPORTANT for CockroachDB: all INTEGER/SERIAL columns come back as BigInt
-- in postgres.js. Keep player IDs as BigInt for DB params; only convert
-- fide_id to Number() for in-memory Map keys (it's ≤8 digits, safe).
-- =============================================================================

-- Required for fuzzy player name search (trigram similarity)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================================================
-- players — graph nodes
-- =============================================================================
-- One row per unique chess player. Players are inserted from:
--   1. PGN Mentor files (famous historical/modern players by name)
--   2. TWIC PGN files (by WhiteFideId / BlackFideId tags)
--   3. Lumbra's Gigabase OTB PGNs (by WhiteFideId / BlackFideId tags)
--   4. FIDE XML rating list (batch upsert of ~541K rated players)
--   5. On-demand via scripts/add-player-fide.js
--
-- fide_id: official FIDE player ID. Null for pre-FIDE-era players (e.g. Morphy).
-- birth_year / death_year: used by the chronological edge filter in lib/bfs.ts
--   to skip provably impossible edges (e.g. Morphy d.1884 → modern player).
--   Populated by scripts/download-fide-xml.js and scripts/set-historical-dates.js.
CREATE TABLE IF NOT EXISTS players (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    fide_id     INTEGER UNIQUE,         -- null for pre-FIDE players
    federation  TEXT,                   -- 3-letter FIDE federation code (e.g. "ITA")
    title       TEXT,                   -- FIDE title (GM, IM, FM, …)
    birth_year  INTEGER,                -- from FIDE XML <birthday> or set-historical-dates.js
    death_year  INTEGER,                -- for deceased historical players only
    slug        TEXT UNIQUE,            -- URL slug e.g. "carlsen-magnus" (populated by etl/add_slugs.py)
    fide_scraped_at TIMESTAMPTZ         -- set when FIDE calc page has been scraped; NULL = not yet scraped
);

-- =============================================================================
-- opponents — graph edges
-- =============================================================================
-- One row per unique (player_a_id, player_b_id) pair where a < b (enforced).
-- game_count accumulates across all PGN sources via ON CONFLICT DO UPDATE.
-- The classical_count / rapid_count / blitz_count split enables the
-- "classical games only" BFS filter in lib/bfs.ts (?tc=classical query param).
--
-- Time-control classification (lib/pgn-utils.ts → classifyTimeControl):
--   classical  = base ≥ 25 min + 40×increment ≥ 1500 s, or moves-per-period
--   rapid      = 600–1499 s effective time
--   blitz      = < 600 s effective time (includes bullet)
--   Event name beats TC string: "Blitz Championship" → blitz regardless of TC.
CREATE TABLE IF NOT EXISTS opponents (
    player_a_id     INTEGER NOT NULL REFERENCES players(id),
    player_b_id     INTEGER NOT NULL REFERENCES players(id),
    game_count      INTEGER NOT NULL DEFAULT 1,
    first_game_date DATE,
    last_game_date  DATE,
    classical_count INTEGER NOT NULL DEFAULT 0,
    rapid_count     INTEGER NOT NULL DEFAULT 0,
    blitz_count     INTEGER NOT NULL DEFAULT 0,
    event_sample    TEXT,               -- one representative event name (for UI display)
    PRIMARY KEY (player_a_id, player_b_id),
    CHECK (player_a_id < player_b_id)
);

-- =============================================================================
-- settings — key/value store for ETL state
-- =============================================================================
-- Used by scripts/update-twic.js to track the last downloaded TWIC issue,
-- enabling incremental weekly updates without a full reload.
CREATE TABLE IF NOT EXISTS settings (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL
);

-- =============================================================================
-- Indexes
-- =============================================================================

-- BFS traversal: look up all opponents of a given player in both directions
CREATE INDEX IF NOT EXISTS idx_opponents_a ON opponents(player_a_id);
CREATE INDEX IF NOT EXISTS idx_opponents_b ON opponents(player_b_id);

-- Fuzzy name search (API: /api/search uses trigram similarity)
CREATE INDEX IF NOT EXISTS idx_players_name_trgm ON players USING gin (name gin_trgm_ops);

-- Fast FIDE ID lookup (used during ETL and by add-player-fide.js)
CREATE INDEX IF NOT EXISTS idx_players_fide_id ON players(fide_id) WHERE fide_id IS NOT NULL;

-- Slug lookup for per-player and pair-distance pages
CREATE UNIQUE INDEX IF NOT EXISTS players_slug_idx ON players(slug) WHERE slug IS NOT NULL;
