"""Type definitions for the chess distance application.

Includes both dataclasses (for internal use) and Pydantic models (for validation).
CockroachDB returns INT8 columns as Python `int` (which is arbitrary precision),
so no special handling is needed for large IDs compared to TypeScript's BigInt concern.
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Optional
from datetime import date, datetime

try:
    from pydantic import BaseModel, Field, ConfigDict
    HAS_PYDANTIC = True
except ImportError:
    HAS_PYDANTIC = False


# ============================================================================
# Dataclass-based types (minimal validation, for internal use)
# ============================================================================


@dataclass
class Player:
    """Chess player record."""
    id: int
    name: str
    fide_id: Optional[int] = None
    federation: Optional[str] = None
    title: Optional[str] = None
    birth_year: Optional[int] = None
    death_year: Optional[int] = None


@dataclass
class OpponentEdge:
    """Edge between two players (recorded games)."""
    player_a_id: int
    player_b_id: int
    game_count: int
    first_game_date: Optional[str] = None
    last_game_date: Optional[str] = None
    classical_count: Optional[int] = None
    rapid_count: Optional[int] = None
    blitz_count: Optional[int] = None


@dataclass
class PathNode:
    """A player and the number of games to the next player in a distance path."""
    player: Player
    game_count: Optional[int]


@dataclass
class DistanceResult:
    """Result of a shortest-path BFS query."""
    distance: int
    path: list[PathNode]


@dataclass
class NeighborData:
    """Top opponent/neighbor of a player."""
    id: int
    name: str
    title: Optional[str] = None
    federation: Optional[str] = None
    game_count: int = 0
    slug: Optional[str] = None


@dataclass
class PlayerData:
    """Full player record with aggregate stats."""
    id: int
    name: str
    fide_id: Optional[int] = None
    federation: Optional[str] = None
    title: Optional[str] = None
    birth_year: Optional[int] = None
    death_year: Optional[int] = None
    total_games: Optional[int] = None
    slug: Optional[str] = None


@dataclass
class SearchResult:
    """Result of a player search query."""
    id: int
    name: str
    title: Optional[str] = None
    federation: Optional[str] = None


@dataclass
class StatsData:
    """Global database statistics."""
    total_players: int
    total_opponent_pairs: int
    total_games: int
    last_updated: Optional[str] = None


# ============================================================================
# Pydantic models (for API validation and JSON serialization)
# ============================================================================

if HAS_PYDANTIC:

    class PlayerModel(BaseModel):
        """Pydantic model for Player records (API responses)."""
        id: int
        name: str
        fide_id: Optional[int] = None
        federation: Optional[str] = None
        title: Optional[str] = None
        birth_year: Optional[int] = None
        death_year: Optional[int] = None

        model_config = ConfigDict(from_attributes=True)

    class OpponentEdgeModel(BaseModel):
        """Pydantic model for opponent pairs."""
        player_a_id: int
        player_b_id: int
        game_count: int
        first_game_date: Optional[str] = None
        last_game_date: Optional[str] = None
        classical_count: Optional[int] = None
        rapid_count: Optional[int] = None
        blitz_count: Optional[int] = None

        model_config = ConfigDict(from_attributes=True)

    class PathNodeModel(BaseModel):
        """Pydantic model for path nodes in distance results."""
        player: PlayerModel
        game_count: Optional[int] = None

    class DistanceResultModel(BaseModel):
        """Pydantic model for distance query results."""
        distance: int
        path: list[PathNodeModel]

    class NeighborDataModel(BaseModel):
        """Pydantic model for neighbor/opponent data."""
        id: int
        name: str
        title: Optional[str] = None
        federation: Optional[str] = None
        game_count: int = 0
        slug: Optional[str] = None

        model_config = ConfigDict(from_attributes=True)

    class PlayerDataModel(BaseModel):
        """Pydantic model for full player data."""
        id: int
        name: str
        fide_id: Optional[int] = None
        federation: Optional[str] = None
        title: Optional[str] = None
        birth_year: Optional[int] = None
        death_year: Optional[int] = None
        total_games: Optional[int] = None
        slug: Optional[str] = None

        model_config = ConfigDict(from_attributes=True)

    class SearchResultModel(BaseModel):
        """Pydantic model for search results."""
        id: int
        name: str
        title: Optional[str] = None
        federation: Optional[str] = None

        model_config = ConfigDict(from_attributes=True)

    class StatsDataModel(BaseModel):
        """Pydantic model for global statistics."""
        total_players: int
        total_opponent_pairs: int
        total_games: int
        last_updated: Optional[str] = None

else:
    # If Pydantic is not installed, create stubs that are just the dataclasses
    PlayerModel = Player  # type: ignore
    OpponentEdgeModel = OpponentEdge  # type: ignore
    PathNodeModel = PathNode  # type: ignore
    DistanceResultModel = DistanceResult  # type: ignore
    NeighborDataModel = NeighborData  # type: ignore
    PlayerDataModel = PlayerData  # type: ignore
    SearchResultModel = SearchResult  # type: ignore
    StatsDataModel = StatsData  # type: ignore
