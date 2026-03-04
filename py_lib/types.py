from dataclasses import dataclass
from typing import Optional


@dataclass
class Player:
    id: int
    name: str
    fide_id: Optional[int] = None
    federation: Optional[str] = None
    title: Optional[str] = None
    birth_year: Optional[int] = None
    death_year: Optional[int] = None


@dataclass
class PathNode:
    player: Player
    game_count: Optional[int]


@dataclass
class DistanceResult:
    distance: int
    path: list[PathNode]
