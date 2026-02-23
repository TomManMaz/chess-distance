-- Enable trigram extension for fuzzy name search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Players table
CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    fide_id INTEGER UNIQUE,
    federation TEXT,
    title TEXT
);

-- Opponent pairs (graph edges) - always store with player_a_id < player_b_id
CREATE TABLE IF NOT EXISTS opponents (
    player_a_id INTEGER NOT NULL REFERENCES players(id),
    player_b_id INTEGER NOT NULL REFERENCES players(id),
    game_count INTEGER NOT NULL DEFAULT 1,
    first_game_date DATE,
    last_game_date DATE,
    classical_count INTEGER NOT NULL DEFAULT 0,
    rapid_count INTEGER NOT NULL DEFAULT 0,
    blitz_count INTEGER NOT NULL DEFAULT 0,
    event_sample TEXT,
    PRIMARY KEY (player_a_id, player_b_id),
    CHECK (player_a_id < player_b_id)
);

-- Indexes for BFS traversal
CREATE INDEX IF NOT EXISTS idx_opponents_a ON opponents(player_a_id);
CREATE INDEX IF NOT EXISTS idx_opponents_b ON opponents(player_b_id);

-- Trigram index for fuzzy name search
CREATE INDEX IF NOT EXISTS idx_players_name_trgm ON players USING gin (name gin_trgm_ops);

-- Index for FIDE ID lookups
CREATE INDEX IF NOT EXISTS idx_players_fide_id ON players(fide_id) WHERE fide_id IS NOT NULL;
