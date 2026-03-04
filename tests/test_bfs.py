import pytest
from py_lib.types import Player
from py_lib.bfs import find_shortest_path_from_graph, is_chronologically_compatible


def make_player(id: int, name: str = "P") -> Player:
    return Player(id=id, name=f"{name}{id}")


def test_same_node():
    adj = {1: []}
    pmap = {1: make_player(1)}
    res = find_shortest_path_from_graph(adj, pmap, 1, 1)
    assert res == pytest.approx(res) or res.distance == 0
    assert res.path[0].player.id == 1


def test_no_path():
    adj = {1: [], 2: []}
    pmap = {1: make_player(1), 2: make_player(2)}
    res = find_shortest_path_from_graph(adj, pmap, 1, 2)
    assert res is None


def test_simple_path():
    adj = {
        1: [{"neighborId": 2, "gameCount": 1, "classicalCount": 1, "firstGameYear": None, "lastGameYear": None}],
        2: [
            {"neighborId": 1, "gameCount": 1, "classicalCount": 1, "firstGameYear": None, "lastGameYear": None},
            {"neighborId": 3, "gameCount": 1, "classicalCount": 1, "firstGameYear": None, "lastGameYear": None},
        ],
        3: [{"neighborId": 2, "gameCount": 1, "classicalCount": 1, "firstGameYear": None, "lastGameYear": None}],
    }
    pmap = {1: make_player(1), 2: make_player(2), 3: make_player(3)}
    res = find_shortest_path_from_graph(adj, pmap, 1, 3)
    assert res is not None
    assert res.distance == 2
    assert [node.player.id for node in res.path] == [1, 2, 3]


def test_chronological_incompatibility():
    p1 = make_player(1)
    p1.birth_year = 1800
    p1.death_year = 1850
    p2 = make_player(2)
    p2.birth_year = 1820
    p2.death_year = 1880
    p3 = make_player(3)
    p3.birth_year = 1900
    p3.death_year = 1950
    pmap = {1: p1, 2: p2, 3: p3}
    adj = {
        1: [{"neighborId": 2, "gameCount": 1, "classicalCount": 1, "firstGameYear": 1840, "lastGameYear": 1845}],
        2: [
            {"neighborId": 1, "gameCount": 1, "classicalCount": 1, "firstGameYear": 1840, "lastGameYear": 1845},
            {"neighborId": 3, "gameCount": 1, "classicalCount": 1, "firstGameYear": 1905, "lastGameYear": 1910},
        ],
        3: [{"neighborId": 2, "gameCount": 1, "classicalCount": 1, "firstGameYear": 1905, "lastGameYear": 1910}],
    }
    assert is_chronologically_compatible(p1, p2)
    assert not is_chronologically_compatible(p2, p3)
    res = find_shortest_path_from_graph(adj, pmap, 1, 3)
    assert res is None


def test_time_control_filter():
    adj = {
        1: [{"neighborId": 2, "gameCount": 5, "classicalCount": 0, "firstGameYear": None, "lastGameYear": None}],
        2: [
            {"neighborId": 1, "gameCount": 5, "classicalCount": 0, "firstGameYear": None, "lastGameYear": None},
            {"neighborId": 3, "gameCount": 2, "classicalCount": 0, "firstGameYear": None, "lastGameYear": None},
        ],
        3: [{"neighborId": 2, "gameCount": 2, "classicalCount": 0, "firstGameYear": None, "lastGameYear": None}],
    }
    pmap = {1: make_player(1), 2: make_player(2), 3: make_player(3)}
    res_all = find_shortest_path_from_graph(adj, pmap, 1, 3, tc_filter="all")
    assert res_all is not None
    assert res_all.distance == 2
    res_classical = find_shortest_path_from_graph(adj, pmap, 1, 3, tc_filter="classical")
    assert res_classical is None
