export interface Player {
  id: number;
  name: string;
  fide_id: number | null;
  federation: string | null;
  title: string | null;
  birth_year: number | null;
  death_year: number | null;
}

export interface OpponentEdge {
  player_a_id: number;
  player_b_id: number;
  game_count: number;
  first_game_date: string | null;
  last_game_date: string | null;
}

export interface PathNode {
  player: Player;
  game_count: number | null; // games between this player and the next in the path
  first_game_date?: string | null; // date of earliest game with next player
  last_game_date?: string | null; // date of latest game with next player
  classical_count?: number; // classical games with next player
  rapid_count?: number; // rapid games with next player
  blitz_count?: number; // blitz games with next player
}

export interface DistanceResult {
  distance: number;
  path: PathNode[];
}

export interface SearchResult {
  id: number;
  name: string;
  title: string | null;
  federation: string | null;
}

export interface StatsData {
  total_players: number;
  total_opponent_pairs: number;
  total_games: number;
  last_updated: string | null;
}
