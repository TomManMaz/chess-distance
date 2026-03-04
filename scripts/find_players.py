from __future__ import annotations
"""Search for player names across local PGN files.

Usage:
    python scripts/find_players.py "Carlsen, Magnus"
    python scripts/find_players.py "Carlsen" "Nakamura"   # any of the names
    python scripts/find_players.py --dirs pgn pgnmentor lumbrasgigabase "Morphy"
"""

import argparse
import sys
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
DEFAULT_DIRS = ["pgn", "pgnmentor", "lumbrasgigabase"]


def search_file(path: Path, targets: list[str]) -> list[str]:
    """Return list of target names found in *path* (case-insensitive)."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace").lower()
    except OSError:
        return []
    return [t for t in targets if t.lower() in text]


def main() -> None:
    parser = argparse.ArgumentParser(description="Search for player names in local PGN files")
    parser.add_argument("names", nargs="+", help="Player name(s) to search for")
    parser.add_argument(
        "--dirs",
        nargs="+",
        default=DEFAULT_DIRS,
        metavar="DIR",
        help=f"Sub-directories of data/ to search (default: {' '.join(DEFAULT_DIRS)})",
    )
    args = parser.parse_args()

    targets = args.names
    print(f"Searching for: {' | '.join(targets)}")

    total_files = 0
    found_any = False

    for dir_name in args.dirs:
        dir_path = DATA_DIR / dir_name
        if not dir_path.is_dir():
            print(f"  [skip] {dir_path} not found", file=sys.stderr)
            continue

        pgn_files = sorted(dir_path.glob("**/*.pgn"))
        total_files += len(pgn_files)

        for pgn in pgn_files:
            hits = search_file(pgn, targets)
            if hits:
                rel = pgn.relative_to(DATA_DIR)
                print(f"  FOUND {hits} in {rel}")
                found_any = True

    if not found_any:
        print("  Not found in any file")
    print(f"Search done ({total_files} files scanned)")


if __name__ == "__main__":
    main()
