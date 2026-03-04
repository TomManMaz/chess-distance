from __future__ import annotations
"""Download TWIC (The Week in Chess) PGN zip files.

Auto-detects the highest issue already in data/pgn/ and downloads
everything newer, stopping after 3 consecutive 404s.

Usage:
    python etl/download_twic.py
    python etl/download_twic.py --start=1634   # force a specific start issue

After downloading, run:
    python etl/batch_pairs.py
"""

import argparse
import sys
import time
import zipfile
from pathlib import Path

import requests

DATA_DIR = Path(__file__).parent.parent / "data" / "pgn"
UA = "Mozilla/5.0 (compatible; chess-distance-etl)"
DELAY_S = 0.25
MAX_CONSECUTIVE_404 = 3


def get_existing_issues() -> set[int]:
    if not DATA_DIR.exists():
        return set()
    return {
        int(m.group(1))
        for f in DATA_DIR.iterdir()
        if (m := __import__('re').match(r'^twic(\d+)\.pgn$', f.name, __import__('re').IGNORECASE))
    }


def download_issue(issue: int) -> Path | None:
    """Download a TWIC zip. Returns the zip Path on success, None on 404."""
    url = f"https://theweekinchess.com/zips/twic{issue}g.zip"
    dest = DATA_DIR / f"twic{issue}g.zip"
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=60, stream=True)
        if r.status_code in (403, 404):
            return None
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(65536):
                f.write(chunk)
        return dest
    except requests.RequestException as e:
        raise RuntimeError(str(e)) from e


def extract_zip(zip_path: Path) -> None:
    """Extract zip using Python's built-in zipfile (cross-platform)."""
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(zip_path.parent)
    zip_path.unlink()


def main() -> None:
    parser = argparse.ArgumentParser(description="Download TWIC PGN archives")
    parser.add_argument("--start", type=int, help="Force a specific starting issue number")
    args = parser.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    existing = get_existing_issues()
    max_existing = max(existing, default=919)
    start_from = args.start if args.start else max_existing + 1

    print("=== TWIC Downloader ===")
    print(f"  Existing PGN files: {len(existing)} (highest: {max_existing})")
    print(f"  Downloading from issue {start_from} onwards")
    print(f"  (Stops after {MAX_CONSECUTIVE_404} consecutive 404s)\n")

    downloaded = 0
    errors = 0
    consecutive_404 = 0

    for issue in range(start_from, start_from + 10_000):
        if issue in existing:
            continue

        print(f"\r  Issue {issue}: downloading...            ", end="", flush=True)

        try:
            zip_path = download_issue(issue)

            if zip_path is None:
                consecutive_404 += 1
                print(f"\r  Issue {issue}: not found (404)           ")
                if consecutive_404 >= MAX_CONSECUTIVE_404:
                    print(f"  {MAX_CONSECUTIVE_404} consecutive 404s — reached end of archive.")
                    break
                continue

            consecutive_404 = 0
            print(f"\r  Issue {issue}: extracting...             ", end="", flush=True)
            extract_zip(zip_path)

            downloaded += 1
            print(f"\r  Issue {issue}: ✓ ({downloaded} downloaded)           ")
            time.sleep(DELAY_S)

        except Exception as e:
            errors += 1
            print(f"\r  Issue {issue}: ERROR — {str(e)[:60]}")

    total = len(existing) + downloaded
    print(f"\n=== Done ===")
    print(f"  Downloaded this run:    {downloaded}")
    print(f"  Errors:                 {errors}")
    print(f"  Total PGN files now:    {total}")
    print(f"\nNext step:")
    print(f"  python etl/batch_pairs.py")


if __name__ == "__main__":
    main()
