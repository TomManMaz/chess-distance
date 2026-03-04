from __future__ import annotations
"""List files in each data/ subdirectory.

Usage:
    python scripts/list_data.py
"""

from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"


def main() -> None:
    if not DATA_DIR.is_dir():
        print(f"data/ directory not found at {DATA_DIR}")
        return

    for sub in sorted(DATA_DIR.iterdir()):
        if not sub.is_dir():
            continue
        files = list(sub.iterdir())
        pgn = [f for f in files if f.suffix == ".pgn"]
        print(f"{sub.name}: {len(files)} files ({len(pgn)} PGNs)")


if __name__ == "__main__":
    main()
