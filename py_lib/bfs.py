from __future__ import annotations
from typing import Optional, Dict, List, Any
from .types import Player, DistanceResult, PathNode

CHRONO_TOLERANCE_YEARS = 10


def is_chronologically_compatible(a: Player, b: Player) -> bool:
    if a.death_year is not None and b.birth_year is not None and a.death_year < b.birth_year:
        return False
    if b.death_year is not None and a.birth_year is not None and b.death_year < a.birth_year:
        return False
    return True


def chrono_compatible(incoming: Optional[Dict[str, Optional[int]]], outgoing: Optional[Dict[str, Optional[int]]]) -> bool:
    # If either hop is the first/last (None), allow.
    if incoming is None or outgoing is None:
        return True

    in_first = incoming.get("firstGameYear")
    in_last = incoming.get("lastGameYear")
    out_first = outgoing.get("firstGameYear")
    out_last = outgoing.get("lastGameYear")

    # If either edge has no date data at all, assume compatible.
    if (in_first is None and in_last is None) or (out_first is None and out_last is None):
        return True

    in_end = in_last if in_last is not None else in_first  # type: ignore
    in_start = in_first if in_first is not None else in_last  # type: ignore
    out_end = out_last if out_last is not None else out_first  # type: ignore
    out_start = out_first if out_first is not None else out_last  # type: ignore

    if in_end + CHRONO_TOLERANCE_YEARS < out_start:
        return False
    if out_end + CHRONO_TOLERANCE_YEARS < in_start:
        return False
    return True


def edge_weight(entry: Dict[str, Any], tc_filter: str) -> int:
    if tc_filter == "classical":
        return int(entry.get("classicalCount", 0))
    return int(entry.get("gameCount", 0))


def get_game_count(adj: Dict[int, List[Dict[str, Any]]], from_id: int, to_id: int, tc_filter: str) -> int:
    neighbors = adj.get(from_id)
    if not neighbors:
        return 0
    for e in neighbors:
        if e.get("neighborId") == to_id:
            return edge_weight(e, tc_filter)
    return 0


def find_shortest_path_from_graph(
    adj: Dict[int, List[Dict[str, Any]]],
    pmap: Dict[int, Player],
    from_id: int,
    to_id: int,
    tc_filter: str = "all",
) -> Optional[DistanceResult]:
    if from_id == to_id:
        player = pmap.get(from_id)
        if not player:
            return None
        return DistanceResult(distance=0, path=[PathNode(player=player, game_count=None)])

    if from_id not in adj or to_id not in adj:
        return None

    parent_forward: Dict[int, Dict[str, Any]] = {from_id: {"parent": -1, "via": None}}
    parent_backward: Dict[int, Dict[str, Any]] = {to_id: {"parent": -1, "via": None}}

    frontier_forward = [from_id]
    frontier_backward = [to_id]
    meeting_node = -1

    while frontier_forward and frontier_backward:
        if len(frontier_forward) <= len(frontier_backward):
            next_frontier: List[int] = []
            for node in frontier_forward:
                neighbors = adj.get(node, [])
                incoming_via = parent_forward[node]["via"]
                sorted_neighbors = [e for e in neighbors if edge_weight(e, tc_filter) > 0]
                sorted_neighbors.sort(key=lambda e: edge_weight(e, tc_filter), reverse=True)
                for entry in sorted_neighbors:
                    neighbor_id = entry["neighborId"]
                    if neighbor_id in parent_forward:
                        continue
                    if not chrono_compatible(incoming_via, entry):
                        continue
                    parent_forward[neighbor_id] = {"parent": node, "via": entry}
                    if neighbor_id in parent_backward:
                        bkwd_via = parent_backward[neighbor_id]["via"]
                        if chrono_compatible(entry, bkwd_via):
                            meeting_node = neighbor_id
                            break
                    else:
                        next_frontier.append(neighbor_id)
                if meeting_node != -1:
                    break
            frontier_forward = next_frontier
        else:
            next_frontier: List[int] = []
            for node in frontier_backward:
                neighbors = adj.get(node, [])
                incoming_via = parent_backward[node]["via"]
                sorted_neighbors = [e for e in neighbors if edge_weight(e, tc_filter) > 0]
                sorted_neighbors.sort(key=lambda e: edge_weight(e, tc_filter), reverse=True)
                for entry in sorted_neighbors:
                    neighbor_id = entry["neighborId"]
                    if neighbor_id in parent_backward:
                        continue
                    if not chrono_compatible(incoming_via, entry):
                        continue
                    parent_backward[neighbor_id] = {"parent": node, "via": entry}
                    if neighbor_id in parent_forward:
                        fwd_via = parent_forward[neighbor_id]["via"]
                        if chrono_compatible(fwd_via, entry):
                            meeting_node = neighbor_id
                            break
                    else:
                        next_frontier.append(neighbor_id)
                if meeting_node != -1:
                    break
            frontier_backward = next_frontier

    if meeting_node == -1:
        return None

    path_forward: List[int] = []
    cur = meeting_node
    while cur != -1:
        path_forward.insert(0, cur)
        cur = parent_forward.get(cur, {}).get("parent", -1)

    path_backward: List[int] = []
    cur = parent_backward.get(meeting_node, {}).get("parent", -1)
    while cur != -1:
        path_backward.append(cur)
        cur = parent_backward.get(cur, {}).get("parent", -1)

    full_path = path_forward + path_backward

    result_path = []
    for i, node_id in enumerate(full_path):
        player = pmap[node_id]
        next_node = full_path[i + 1] if i + 1 < len(full_path) else None
        gc = get_game_count(adj, node_id, next_node, tc_filter) if next_node is not None else None
        result_path.append(PathNode(player=player, game_count=gc))

    return DistanceResult(distance=len(full_path) - 1, path=result_path)
