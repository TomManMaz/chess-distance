"""In-memory graph cache and BFS for the FastAPI backend.

Mirrors lib/bfs.ts but runs as a persistent Python process, so the graph
stays warm between requests — eliminating the cold-start problem.

Load strategy (same as the TypeScript lean-load refactor):
  - Graph build: only id/birth_year/death_year per player + 4 ints per edge
  - Post-BFS enrichment: full player data + rapid/blitz/dates for path edges only
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Callable, Coroutine, Optional

import asyncpg

CHRONO_TOLERANCE_YEARS = 10
CACHE_TTL = 3600  # 1 hour


# ─── Types ────────────────────────────────────────────────────────────────────

@dataclass
class AdjEntry:
    neighbor_id: int
    game_count: int
    classical_count: int
    first_game_year: Optional[int]
    last_game_year: Optional[int]


@dataclass
class GraphCache:
    adjacency: dict[int, list[AdjEntry]]
    bfs_players: dict[int, tuple[Optional[int], Optional[int]]]  # id → (birth_year, death_year)
    loaded_at: float


# ─── Module-level singleton ────────────────────────────────────────────────────

_cache: Optional[GraphCache] = None
_load_lock: Optional[asyncio.Lock] = None


def _get_lock() -> asyncio.Lock:
    global _load_lock
    if _load_lock is None:
        _load_lock = asyncio.Lock()
    return _load_lock


def is_cache_warm() -> bool:
    return _cache is not None and time.time() - _cache.loaded_at < CACHE_TTL


# ─── Chronological helpers ─────────────────────────────────────────────────────

def _is_chrono_compatible(
    a: tuple[Optional[int], Optional[int]],
    b: tuple[Optional[int], Optional[int]],
) -> bool:
    a_birth, a_death = a
    b_birth, b_death = b
    if a_death is not None and b_birth is not None and a_death < b_birth:
        return False
    if b_death is not None and a_birth is not None and b_death < a_birth:
        return False
    return True


def _chrono_compatible(
    incoming: Optional[AdjEntry],
    outgoing: Optional[AdjEntry],
) -> bool:
    if incoming is None or outgoing is None:
        return True
    if_first = incoming.first_game_year
    if_last  = incoming.last_game_year
    of_first = outgoing.first_game_year
    of_last  = outgoing.last_game_year
    if (if_first is None and if_last is None) or (of_first is None and of_last is None):
        return True
    in_end   = if_last  if if_last  is not None else if_first
    in_start = if_first if if_first is not None else if_last
    out_end  = of_last  if of_last  is not None else of_first
    out_start = of_first if of_first is not None else of_last
    if in_end + CHRONO_TOLERANCE_YEARS < out_start:   # type: ignore[operator]
        return False
    if out_end + CHRONO_TOLERANCE_YEARS < in_start:   # type: ignore[operator]
        return False
    return True


def _edge_weight(entry: AdjEntry, tc_filter: str) -> int:
    return entry.classical_count if tc_filter == "classical" else entry.game_count


# ─── Graph loading ─────────────────────────────────────────────────────────────

StatusCallback = Callable[[str], Coroutine]


async def load_graph(
    pool: asyncpg.Pool,
    on_status: Optional[StatusCallback] = None,
) -> GraphCache:
    global _cache

    async with _get_lock():
        # Double-checked locking: another coroutine may have loaded while we waited
        if is_cache_warm():
            return _cache  # type: ignore[return-value]

        async with pool.acquire() as conn:
            # ── Players (lean: id + birth/death only) ──────────────────────────
            if on_status:
                await on_status("Loading players…")
            player_rows = await conn.fetch(
                "SELECT id, birth_year, death_year FROM players"
            )
            bfs_players: dict[int, tuple[Optional[int], Optional[int]]] = {
                int(r["id"]): (r["birth_year"], r["death_year"])
                for r in player_rows
            }

            # ── Edges (lean: game counts + year ints only) ─────────────────────
            if on_status:
                await on_status("Loading game graph…")
            try:
                edge_rows = await conn.fetch("""
                    SELECT player_a_id, player_b_id, game_count, classical_count,
                           EXTRACT(YEAR FROM first_game_date)::int AS first_game_year,
                           EXTRACT(YEAR FROM last_game_date)::int  AS last_game_year
                    FROM opponents
                """)
            except Exception:
                edge_rows = await conn.fetch("""
                    SELECT player_a_id, player_b_id, game_count,
                           game_count AS classical_count,
                           NULL::int AS first_game_year,
                           NULL::int AS last_game_year
                    FROM opponents
                """)

            # ── Build adjacency map ────────────────────────────────────────────
            if on_status:
                await on_status("Building search index…")
            adj: dict[int, list[AdjEntry]] = {}
            for r in edge_rows:
                a  = int(r["player_a_id"])
                b  = int(r["player_b_id"])
                gc = int(r["game_count"])
                cc = int(r["classical_count"]) or gc
                fy = int(r["first_game_year"]) if r["first_game_year"] is not None else None
                ly = int(r["last_game_year"])  if r["last_game_year"]  is not None else None

                pa = bfs_players.get(a)
                pb = bfs_players.get(b)
                if pa and pb and not _is_chrono_compatible(pa, pb):
                    continue

                if a not in adj:
                    adj[a] = []
                if b not in adj:
                    adj[b] = []
                adj[a].append(AdjEntry(b, gc, cc, fy, ly))
                adj[b].append(AdjEntry(a, gc, cc, fy, ly))

        _cache = GraphCache(adj, bfs_players, time.time())
        return _cache


# ─── BFS ───────────────────────────────────────────────────────────────────────

def bfs_raw(
    adj: dict[int, list[AdjEntry]],
    bfs_players: dict[int, tuple[Optional[int], Optional[int]]],
    from_id: int,
    to_id: int,
    tc_filter: str = "all",
) -> Optional[list[int]]:
    """Bidirectional BFS. Returns ordered list of player IDs or None."""
    if from_id == to_id:
        return [from_id]
    if from_id not in adj or to_id not in adj:
        return None

    ParentInfo = tuple[int, Optional[AdjEntry]]  # (parent_id, via_edge)
    fwd: dict[int, ParentInfo] = {from_id: (-1, None)}
    bwd: dict[int, ParentInfo] = {to_id:   (-1, None)}
    frontier_fwd = [from_id]
    frontier_bwd = [to_id]
    meeting = -1

    while frontier_fwd and frontier_bwd:
        if len(frontier_fwd) <= len(frontier_bwd):
            next_f: list[int] = []
            for node in frontier_fwd:
                incoming = fwd[node][1]
                neighbors = sorted(
                    (e for e in adj.get(node, []) if _edge_weight(e, tc_filter) > 0),
                    key=lambda e: _edge_weight(e, tc_filter),
                    reverse=True,
                )
                for entry in neighbors:
                    nb = entry.neighbor_id
                    if nb in fwd:
                        continue
                    if not _chrono_compatible(incoming, entry):
                        continue
                    fwd[nb] = (node, entry)
                    if nb in bwd:
                        if _chrono_compatible(entry, bwd[nb][1]):
                            meeting = nb
                            break
                    else:
                        next_f.append(nb)
                if meeting != -1:
                    break
            frontier_fwd = next_f
        else:
            next_b: list[int] = []
            for node in frontier_bwd:
                incoming = bwd[node][1]
                neighbors = sorted(
                    (e for e in adj.get(node, []) if _edge_weight(e, tc_filter) > 0),
                    key=lambda e: _edge_weight(e, tc_filter),
                    reverse=True,
                )
                for entry in neighbors:
                    nb = entry.neighbor_id
                    if nb in bwd:
                        continue
                    if not _chrono_compatible(incoming, entry):
                        continue
                    bwd[nb] = (node, entry)
                    if nb in fwd:
                        if _chrono_compatible(fwd[nb][1], entry):
                            meeting = nb
                            break
                    else:
                        next_b.append(nb)
                if meeting != -1:
                    break
            frontier_bwd = next_b

        if meeting != -1:
            break

    if meeting == -1:
        return None

    path: list[int] = []
    cur = meeting
    while cur != -1:
        path.insert(0, cur)
        cur = fwd.get(cur, (-1, None))[0]

    cur = bwd.get(meeting, (-1, None))[0]
    while cur != -1:
        path.append(cur)
        cur = bwd.get(cur, (-1, None))[0]

    return path


# ─── Full distance computation with enrichment ─────────────────────────────────

async def find_shortest_path(
    pool: asyncpg.Pool,
    from_id: int,
    to_id: int,
    tc_filter: str = "all",
    on_status: Optional[StatusCallback] = None,
) -> Optional[dict]:
    """Load graph (cached), run BFS, enrich path nodes and edges, return dict."""
    graph = await load_graph(pool, on_status)
    adj = graph.adjacency
    bfs_players = graph.bfs_players

    if on_status:
        await on_status("Searching for shortest path…")

    if from_id == to_id:
        # Single-player case: fetch full player data
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id, name, fide_id, federation, title, birth_year, death_year "
                "FROM players WHERE id = $1", from_id
            )
        if not row:
            return None
        player = _row_to_player(row)
        return {"distance": 0, "path": [{"player": player, "game_count": None,
                                          "first_game_date": None, "last_game_date": None,
                                          "classical_count": 0, "rapid_count": 0, "blitz_count": 0}]}

    raw_path = bfs_raw(adj, bfs_players, from_id, to_id, tc_filter)
    if raw_path is None:
        return None

    if on_status:
        await on_status("Fetching path details…")

    async with pool.acquire() as conn:
        # Enrich players
        player_rows = await conn.fetch(
            "SELECT id, name, fide_id, federation, title, birth_year, death_year "
            f"FROM players WHERE id = ANY($1::int8[])",
            raw_path,
        )
        player_map: dict[int, dict] = {int(r["id"]): _row_to_player(r) for r in player_rows}

        # Enrich edges (rapid/blitz/dates for path edges only)
        edge_map: dict[tuple[int, int], asyncpg.Record] = {}
        if len(raw_path) > 1:
            clauses = " OR ".join(
                f"(player_a_id = {min(raw_path[i], raw_path[i+1])} "
                f"AND player_b_id = {max(raw_path[i], raw_path[i+1])})"
                for i in range(len(raw_path) - 1)
            )
            try:
                edge_rows = await conn.fetch(
                    f"SELECT player_a_id, player_b_id, rapid_count, blitz_count, "
                    f"first_game_date, last_game_date FROM opponents WHERE {clauses}"
                )
                for r in edge_rows:
                    key = (int(r["player_a_id"]), int(r["player_b_id"]))
                    edge_map[key] = r
            except Exception:
                pass  # columns may not exist

    # Build path nodes
    path_nodes = []
    for i, node_id in enumerate(raw_path):
        player = player_map.get(node_id) or {"id": node_id, "name": str(node_id),
                                              "fide_id": None, "federation": None,
                                              "title": None, "birth_year": None, "death_year": None}
        gc = cc = rc = bc = 0
        fd = ld = None
        next_id = raw_path[i + 1] if i + 1 < len(raw_path) else None
        if next_id is not None:
            # Game count from adj (already in memory)
            for e in adj.get(node_id, []):
                if e.neighbor_id == next_id:
                    gc = _edge_weight(e, tc_filter)
                    cc = e.classical_count
                    break
            # Rich metadata from enrichment
            key = (min(node_id, next_id), max(node_id, next_id))
            er = edge_map.get(key)
            if er:
                rc = int(er["rapid_count"] or 0)
                bc = int(er["blitz_count"] or 0)
                fd = str(er["first_game_date"]) if er["first_game_date"] else None
                ld = str(er["last_game_date"])  if er["last_game_date"]  else None

        path_nodes.append({
            "player": player,
            "game_count": gc if next_id is not None else None,
            "first_game_date": fd,
            "last_game_date": ld,
            "classical_count": cc,
            "rapid_count": rc,
            "blitz_count": bc,
        })

    return {"distance": len(raw_path) - 1, "path": path_nodes}


def _row_to_player(row: asyncpg.Record) -> dict:
    return {
        "id": int(row["id"]),
        "name": row["name"],
        "fide_id": int(row["fide_id"]) if row["fide_id"] is not None else None,
        "federation": row["federation"],
        "title": row["title"],
        "birth_year": int(row["birth_year"]) if row["birth_year"] is not None else None,
        "death_year": int(row["death_year"]) if row["death_year"] is not None else None,
    }
