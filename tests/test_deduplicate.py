"""Tests for etl/deduplicate_players.py — no DB required."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from etl.deduplicate_players import pick_canonical


class TestPickCanonical:
    def _p(self, name, fide_id=None, total_games=0):
        return {"name": name, "fide_id": fide_id, "total_games": total_games}

    def test_prefers_fide_id(self):
        players = [
            self._p("Kasparov, G", fide_id=None, total_games=100),
            self._p("Kasparov, Garry", fide_id=4100018, total_games=10),
        ]
        assert pick_canonical(players)["name"] == "Kasparov, Garry"

    def test_prefers_more_games_when_no_fide_id(self):
        players = [
            self._p("Morphy, P", fide_id=None, total_games=5),
            self._p("Morphy, Paul", fide_id=None, total_games=50),
        ]
        assert pick_canonical(players)["name"] == "Morphy, Paul"

    def test_prefers_longer_name_as_tiebreaker(self):
        players = [
            self._p("Fischer, R", fide_id=None, total_games=10),
            self._p("Fischer, Robert", fide_id=None, total_games=10),
        ]
        assert pick_canonical(players)["name"] == "Fischer, Robert"

    def test_single_player_returned_unchanged(self):
        players = [self._p("Carlsen, Magnus", fide_id=1503014, total_games=999)]
        assert pick_canonical(players)["name"] == "Carlsen, Magnus"

    def test_fide_beats_more_games(self):
        # A player with FIDE ID but fewer games beats one with more games but no FIDE ID
        players = [
            self._p("Anand, V", fide_id=None, total_games=1000),
            self._p("Anand, Viswanathan", fide_id=5000017, total_games=1),
        ]
        assert pick_canonical(players)["name"] == "Anand, Viswanathan"

    def test_three_candidates(self):
        players = [
            self._p("Tal, M", fide_id=None, total_games=20),
            self._p("Tal, Mi", fide_id=None, total_games=20),
            self._p("Tal, Mihail", fide_id=None, total_games=20),
        ]
        # All tied on fide_id and total_games — longest name wins
        assert pick_canonical(players)["name"] == "Tal, Mihail"
