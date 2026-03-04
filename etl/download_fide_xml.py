from __future__ import annotations
"""Download and import the FIDE standard rating list XML.

Downloads the zip, extracts the XML, streams it with iterparse (memory-
efficient even for the ~600 MB unzipped file), then batch-upserts all
~541K rated players into the `players` table by fide_id.

Usage:
    DATABASE_URL=... python etl/download_fide_xml.py
    DATABASE_URL=... python etl/download_fide_xml.py --no-download   # re-parse existing file
"""

import argparse
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import psycopg.rows
import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from etl.db import get_conn

DATA_DIR = Path(__file__).parent.parent / "data"
ZIP_PATH = DATA_DIR / "fide_standard.zip"
EXTRACT_DIR = DATA_DIR / "fide"
FIDE_URL = "https://ratings.fide.com/download/standard_rating_list_xml.zip"
BATCH_SIZE = 500
UA = "Mozilla/5.0 (compatible; chess-distance-etl)"


def download_fide_zip() -> None:
    print(f"  Downloading from {FIDE_URL} ...")
    r = requests.get(FIDE_URL, headers={"User-Agent": UA}, stream=True, timeout=300)
    r.raise_for_status()
    total = int(r.headers.get("content-length", 0))
    received = 0
    with open(ZIP_PATH, "wb") as f:
        for chunk in r.iter_content(65536):
            f.write(chunk)
            received += len(chunk)
            if total:
                pct = int(received / total * 100)
                mb = received / 1024 / 1024
                total_mb = total / 1024 / 1024
                print(f"\r  {pct}% ({mb:.1f} MB / {total_mb:.1f} MB)", end="", flush=True)
    print()


def extract_zip() -> Path:
    EXTRACT_DIR.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(ZIP_PATH) as zf:
        zf.extractall(EXTRACT_DIR)
    # Find the standard (not rapid/blitz) XML file
    xmls = list(EXTRACT_DIR.glob("*.xml"))
    if not xmls:
        raise FileNotFoundError(f"No XML file found in {EXTRACT_DIR}")
    standard = next((x for x in xmls if 'standard' in x.name.lower()), xmls[0])
    return standard


def parse_fide_xml(xml_path: Path) -> list[dict]:
    """Stream-parse FIDE XML with iterparse. Memory-efficient for large files."""
    players = []
    for _event, elem in ET.iterparse(xml_path, events=('end',)):
        if elem.tag == 'player':
            fide_id = elem.findtext('fideid')
            name = elem.findtext('name')
            if fide_id and name:
                title = (elem.findtext('title') or '').strip() or \
                        (elem.findtext('w_title') or '').strip() or None
                birthday = elem.findtext('birthday') or None
                birth_year = int(birthday[:4]) if birthday and len(birthday) >= 4 and birthday[:4].isdigit() else None
                players.append({
                    'fide_id': int(fide_id),
                    'name': name.strip(),
                    'federation': (elem.findtext('country') or '').strip() or None,
                    'title': title,
                    'birth_year': birth_year,
                })
            elem.clear()  # free memory
        if len(players) % 50_000 == 0 and players:
            print(f"\r  Parsed {len(players):,} players...", end="", flush=True)
    print(f"\r  Parsed {len(players):,} players     ")
    return players


def upsert_players(conn, players: list[dict]) -> None:
    total = len(players)
    done = 0
    with conn.cursor() as cur:
        for i in range(0, total, BATCH_SIZE):
            chunk = players[i:i + BATCH_SIZE]
            placeholders = ','.join(['(%s,%s,%s,%s,%s)'] * len(chunk))
            params: list = []
            for p in chunk:
                params.extend([p['fide_id'], p['name'], p['federation'], p['title'], p['birth_year']])
            cur.execute(f"""
                INSERT INTO players (fide_id, name, federation, title, birth_year)
                VALUES {placeholders}
                ON CONFLICT (fide_id) DO UPDATE SET
                    name       = EXCLUDED.name,
                    federation = EXCLUDED.federation,
                    title      = EXCLUDED.title,
                    birth_year = COALESCE(players.birth_year, EXCLUDED.birth_year)
            """, params)
            conn.commit()
            done += len(chunk)
            pct = int(done / total * 100)
            print(f"\r  Upserted {done:,} / {total:,} ({pct}%)", end="", flush=True)
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description="Download and import FIDE rating list XML")
    parser.add_argument("--no-download", action="store_true", help="Skip download, re-parse existing file")
    args = parser.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = get_conn()

    # Step 1: Download
    if args.no_download:
        print("=== Step 1: Skipping download (--no-download) ===")
    else:
        print("=== Step 1: Downloading FIDE standard rating list XML ===")
        if ZIP_PATH.exists():
            print(f"  ZIP already exists at {ZIP_PATH}. Delete it to re-download.")
        else:
            download_fide_zip()
            print(f"  Saved to {ZIP_PATH}")

    # Step 2: Extract
    print("\n=== Step 2: Extracting XML ===")
    xml_path = extract_zip()
    print(f"  {xml_path.name}")

    # Step 3: Parse
    print("\n=== Step 3: Parsing XML ===")
    players = parse_fide_xml(xml_path)

    # Step 4: Upsert
    print("\n=== Step 4: Upserting into database ===")
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT count(*) AS n FROM players")
        before = cur.fetchone()['n']

    upsert_players(conn, players)

    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT count(*) AS n FROM players")
        after = cur.fetchone()['n']

    print(f"\n=== Done ===")
    print(f"  FIDE players processed: {len(players):,}")
    print(f"  DB players before:      {before:,}")
    print(f"  DB players after:       {after:,} (+{after - before:,} new)")
    print(f"\nNext step: python etl/batch_pairs.py")
    conn.close()


if __name__ == "__main__":
    main()
