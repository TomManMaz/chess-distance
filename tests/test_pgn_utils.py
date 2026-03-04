"""Tests for etl/pgn_utils.py — no DB or filesystem dependencies."""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from etl.pgn_utils import (
    classify_time_control,
    normalize_date,
    normalize_name,
    parse_header,
    stream_pgn,
)


# ---------------------------------------------------------------------------
# parse_header
# ---------------------------------------------------------------------------

class TestParseHeader:
    def test_valid_white(self):
        assert parse_header('[White "Carlsen, Magnus"]') == ("White", "Carlsen, Magnus")

    def test_valid_event(self):
        assert parse_header('[Event "World Chess Championship 2023"]') == (
            "Event",
            "World Chess Championship 2023",
        )

    def test_empty_value(self):
        assert parse_header('[Result ""]') == ("Result", "")

    def test_question_mark_value(self):
        assert parse_header('[White "?"]') == ("White", "?")

    def test_non_header_line(self):
        assert parse_header("1. e4 e5 2. Nf3") is None

    def test_blank_line(self):
        assert parse_header("") is None

    def test_comment_line(self):
        assert parse_header("; this is a comment") is None

    def test_no_trailing_bracket(self):
        assert parse_header('[White "Carlsen, Magnus"') is None


# ---------------------------------------------------------------------------
# normalize_name
# ---------------------------------------------------------------------------

class TestNormalizeName:
    def test_no_change_needed(self):
        assert normalize_name("Carlsen, Magnus") == "Carlsen, Magnus"

    def test_missing_space_after_comma(self):
        assert normalize_name("Carlsen,Magnus") == "Carlsen, Magnus"

    def test_strips_whitespace(self):
        assert normalize_name("  Carlsen, Magnus  ") == "Carlsen, Magnus"

    def test_already_correct(self):
        assert normalize_name("Fischer, Robert James") == "Fischer, Robert James"

    def test_multiple_commas(self):
        # Only fixes missing space; multiple commas handled gracefully
        result = normalize_name("Last,First,Extra")
        assert "Last, First, Extra" == result

    def test_no_comma(self):
        assert normalize_name("Kasparov") == "Kasparov"


# ---------------------------------------------------------------------------
# normalize_date
# ---------------------------------------------------------------------------

class TestNormalizeDate:
    def test_valid_date(self):
        assert normalize_date("2024.03.15") == "2024-03-15"

    def test_already_hyphenated(self):
        assert normalize_date("2024-03-15") == "2024-03-15"

    def test_none_input(self):
        assert normalize_date(None) is None

    def test_empty_string(self):
        assert normalize_date("") is None

    def test_question_marks(self):
        assert normalize_date("????.??.??") is None

    def test_partial_question_marks(self):
        assert normalize_date("2024.03.??") is None

    def test_invalid_day(self):
        assert normalize_date("2024.02.30") is None

    def test_invalid_month(self):
        assert normalize_date("2024.13.01") is None

    def test_leap_year_valid(self):
        assert normalize_date("2024.02.29") == "2024-02-29"

    def test_non_leap_year_feb29(self):
        assert normalize_date("2023.02.29") is None

    def test_april_31(self):
        assert normalize_date("2024.04.31") is None


# ---------------------------------------------------------------------------
# classify_time_control
# ---------------------------------------------------------------------------

class TestClassifyTimeControl:
    # Classical
    def test_classical_long(self):
        assert classify_time_control("7200+30", None) == "classical"

    def test_classical_no_tc(self):
        assert classify_time_control(None, None) == "classical"

    def test_classical_question_mark(self):
        assert classify_time_control("?", None) == "classical"

    def test_classical_dash(self):
        assert classify_time_control("-", None) == "classical"

    def test_classical_moves_per_period(self):
        assert classify_time_control("40/7200", None) == "classical"

    def test_classical_boundary(self):
        # base=1500 → classical
        assert classify_time_control("1500", None) == "classical"

    # Rapid
    def test_rapid(self):
        assert classify_time_control("900+10", None) == "rapid"

    def test_rapid_boundary_low(self):
        # base=600, inc=0 → effective=600 → rapid
        assert classify_time_control("600", None) == "rapid"

    def test_rapid_boundary_high(self):
        # base=1499, inc=0 → effective=1499 → rapid
        assert classify_time_control("1499", None) == "rapid"

    # Blitz
    def test_blitz(self):
        assert classify_time_control("180+2", None) == "blitz"

    def test_blitz_bullet(self):
        assert classify_time_control("60", None) == "blitz"

    def test_blitz_boundary(self):
        # base=599, inc=0 → effective=599 → blitz
        assert classify_time_control("599", None) == "blitz"

    # Event name overrides TC string
    def test_event_blitz_overrides_tc(self):
        assert classify_time_control("900+10", "World Blitz Championship") == "blitz"

    def test_event_rapid_overrides_tc(self):
        assert classify_time_control("180+2", "Grand Prix Rapid 2024") == "rapid"

    def test_event_bullet_overrides_tc(self):
        assert classify_time_control("180", "Bullet Tournament") == "blitz"

    def test_event_titled_tuesday(self):
        assert classify_time_control("180+2", "Titled Tuesday Blitz") == "blitz"

    def test_event_classical_no_keyword(self):
        # No matching keyword → fall through to TC string
        assert classify_time_control("180+2", "Linares 1994") == "blitz"


# ---------------------------------------------------------------------------
# stream_pgn
# ---------------------------------------------------------------------------

def _write_pgn(tmp_path, content: str) -> Path:
    p = tmp_path / "test.pgn"
    p.write_text(textwrap.dedent(content), encoding="utf-8")
    return p


class TestStreamPgn:
    def test_single_game(self, tmp_path):
        pgn = _write_pgn(tmp_path, """\
            [White "Carlsen, Magnus"]
            [Black "Nakamura, Hikaru"]
            [Date "2024.01.01"]

            1. e4 e5 *
        """)
        games = list(stream_pgn(pgn))
        assert len(games) == 1
        assert games[0]["White"] == "Carlsen, Magnus"
        assert games[0]["Black"] == "Nakamura, Hikaru"

    def test_two_games(self, tmp_path):
        pgn = _write_pgn(tmp_path, """\
            [White "Carlsen, Magnus"]
            [Black "Nakamura, Hikaru"]

            1. e4 e5 *

            [White "Caruana, Fabiano"]
            [Black "So, Wesley"]

            1. d4 d5 *
        """)
        games = list(stream_pgn(pgn))
        assert len(games) == 2

    def test_skips_unknown_player(self, tmp_path):
        pgn = _write_pgn(tmp_path, """\
            [White "?"]
            [Black "Nakamura, Hikaru"]

            1. e4 *
        """)
        assert list(stream_pgn(pgn)) == []

    def test_skips_same_player_both_sides(self, tmp_path):
        pgn = _write_pgn(tmp_path, """\
            [White "Carlsen, Magnus"]
            [Black "Carlsen, Magnus"]

            1. e4 *
        """)
        assert list(stream_pgn(pgn)) == []

    def test_empty_file(self, tmp_path):
        pgn = tmp_path / "empty.pgn"
        pgn.write_text("", encoding="utf-8")
        assert list(stream_pgn(pgn)) == []

    def test_preserves_headers(self, tmp_path):
        pgn = _write_pgn(tmp_path, """\
            [White "Kasparov, Garry"]
            [Black "Deep Blue"]
            [Date "1997.05.11"]
            [TimeControl "7200+0"]

            1. e4 *
        """)
        games = list(stream_pgn(pgn))
        assert games[0]["TimeControl"] == "7200+0"
        assert games[0]["Date"] == "1997.05.11"
