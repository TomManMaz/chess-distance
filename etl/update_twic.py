from __future__ import annotations
"""Incremental TWIC updater — no TRUNCATE, no full reload.

Downloads new TWIC issues not yet in the database, parses them, and
upserts players + opponent pairs using ON CONFLICT. Tracks the last
processed issue in the `settings` table.

Designed for the weekly GitHub Actions cron (.github/workflows/twic-update.yml).

Usage:
    DATABASE_URL=... python etl/update_twic.py
    DATABASE_URL=... python etl/update_twic.py --dry-run
"""

import argparse
import sys
import time
import zipfile
from pathlib import Path

import psycopg.rows
import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from etl.db import get_conn
from etl.pgn_utils import normalize_name, normalize_date, classify_time_control, stream_pgn

DATA_DIR = Path(__file__).parent.parent / "data" / "pgn"
UA = "Mozilla/5.0 (compatible; chess-distance-etl)"
DELAY_S = 0.3
MAX_CONSECUTIVE_404 = 3
BATCH_SIZE = 500
DEFAULT_LAST_ISSUE = 1633


# ---------------------------------------------------------------------------
# Settings table helpers
# ---------------------------------------------------------------------------

def get_setting(conn, key: str, default: str) -> str:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT value FROM settings WHERE key = %s", (key,))
        row = cur.fetchone()
    return row['value'] if row else default


def set_setting(conn, key: str, value: str) -> None:
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO settings (key, value) VALUES (%s, %s)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        """, (key, value))
    conn.commit()


# ---------------------------------------------------------------------------
# Download helpers
# ---------------------------------------------------------------------------

def download_issue(issue: int) -> Path | None:
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


def extract_zip(zip_path: Path) -> Path | None:
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(zip_path.parent)
    zip_path.unlink()
    # TWIC zips extract to twic{N}g.pgn; fall back to twic{N}.pgn
    issue = zip_path.stem.rstrip('g').lstrip('twic')
    for name in [f"twic{issue}g.pgn", f"twic{issue}.pgn"]:
        p = zip_path.parent / name
        if p.exists():
            return p
    return None


# ---------------------------------------------------------------------------
# DB upsert helpers
# ---------------------------------------------------------------------------

def upsert_pairs(conn, pairs: list[dict]) -> int:
    inserted = 0
    with conn.cursor() as cur:
        for i in range(0, len(pairs), BATCH_SIZE):
            chunk = pairs[i:i + BATCH_SIZE]
            placeholders = ','.join(['(%s,%s,%s,%s::date,%s::date,%s,%s,%s,%s)'] * len(chunk))
            params: list = []
            for p in chunk:
                params.extend([p['a'], p['b'], p['count'],
                                p['first'], p['last'],
                                p['classical'], p['rapid'], p['blitz'], p['event']])
            cur.execute(f"""
                INSERT INTO opponents (
                    player_a_id, player_b_id, game_count,
                    first_game_date, last_game_date,
                    classical_count, rapid_count, blitz_count, event_sample
                ) VALUES {placeholders}
                ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET
                    game_count      = opponents.game_count      + EXCLUDED.game_count,
                    first_game_date = LEAST(opponents.first_game_date, EXCLUDED.first_game_date),
                    last_game_date  = GREATEST(opponents.last_game_date, EXCLUDED.last_game_date),
                    classical_count = opponents.classical_count + EXCLUDED.classical_count,
                    rapid_count     = opponents.rapid_count     + EXCLUDED.rapid_count,
                    blitz_count     = opponents.blitz_count     + EXCLUDED.blitz_count,
                    event_sample    = COALESCE(opponents.event_sample, EXCLUDED.event_sample)
            """, params)
            conn.commit()
            inserted += len(chunk)
    return inserted


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Incremental TWIC updater")
    parser.add_argument("--dry-run", action="store_true", help="Download and parse but don't write to DB")
    args = parser.parse_args()

    conn = get_conn()
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    last_issue = int(get_setting(conn, "last_twic_issue", str(DEFAULT_LAST_ISSUE)))
    start_from = last_issue + 1

    print("=== Incremental TWIC Updater ===")
    print(f"  Last processed issue: {last_issue}")
    print(f"  Downloading from:     {start_from}\n")

    if args.dry_run:
        print("*** DRY-RUN MODE ***\n")

    # 1. Download new issues
    downloaded: list[tuple[int, Path]] = []
    consecutive_404 = 0

    for issue in range(start_from, start_from + 10_000):
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
            pgn_path = extract_zip(zip_path)
            if pgn_path:
                downloaded.append((issue, pgn_path))
                print(f"\r  Issue {issue}: ✓ ({len(downloaded)} downloaded)           ")
            else:
                print(f"\r  Issue {issue}: extracted but no PGN found")
            time.sleep(DELAY_S)
        except Exception as e:
            print(f"\r  Issue {issue}: ERROR — {str(e)[:60]}")

    if not downloaded:
        print("\nNo new issues found. DB is up to date.")
        conn.close()
        return

    print(f"\nDownloaded {len(downloaded)} new issue(s). Parsing games...\n")

    # 2. Parse all new PGNs
    players_by_key: dict[str, dict] = {}
    pair_counts: dict[str, dict] = {}
    total_games = 0

    for issue, pgn_path in downloaded:
        games = list(stream_pgn(pgn_path))
        total_games += len(games)
        print(f"  Issue {issue}: {len(games):,} games ({pgn_path.name})")

        for g in games:
            w_fide = int(g['WhiteFideId']) if g.get('WhiteFideId', '').strip().isdigit() else None
            b_fide = int(g['BlackFideId']) if g.get('BlackFideId', '').strip().isdigit() else None
            w_name = normalize_name(g['White'])
            b_name = normalize_name(g['Black'])
            w_key = f"fide:{w_fide}" if w_fide else f"name:{w_name.lower()}"
            b_key = f"fide:{b_fide}" if b_fide else f"name:{b_name.lower()}"

            players_by_key.setdefault(w_key, {'name': w_name, 'fide_id': w_fide, 'title': g.get('WhiteTitle') or None})
            players_by_key.setdefault(b_key, {'name': b_name, 'fide_id': b_fide, 'title': g.get('BlackTitle') or None})

            if w_key == b_key:
                continue

            pk = f"{w_key}||{b_key}" if w_key < b_key else f"{b_key}||{w_key}"
            game_date = normalize_date(g.get('Date'))
            tc = classify_time_control(g.get('TimeControl'), g.get('Event'))
            event_name = g.get('Event')
            if not event_name or event_name in ('?', '??') or len(event_name) <= 1:
                event_name = None

            if pk in pair_counts:
                entry = pair_counts[pk]
                entry['count'] += 1
                entry[tc] += 1
                if game_date:
                    if not entry['first'] or game_date < entry['first']:
                        entry['first'] = game_date
                    if not entry['last'] or game_date > entry['last']:
                        entry['last'] = game_date
                if not entry['event'] and event_name:
                    entry['event'] = event_name
            else:
                pair_counts[pk] = {
                    'count': 1, 'first': game_date, 'last': game_date,
                    'classical': 1 if tc == 'classical' else 0,
                    'rapid':     1 if tc == 'rapid'     else 0,
                    'blitz':     1 if tc == 'blitz'     else 0,
                    'event': event_name,
                }

    print(f"\n  Total games: {total_games:,}  |  Players: {len(players_by_key):,}  |  Pairs: {len(pair_counts):,}")

    if args.dry_run:
        print("\n[DRY-RUN] Skipping DB writes.")
        for _, pgn_path in downloaded:
            pgn_path.unlink(missing_ok=True)
        conn.close()
        return

    # 3. Load existing player maps
    print("\n=== Loading player ID maps from DB ===")
    fide_to_id: dict[int, int] = {}
    name_to_id: dict[str, int] = {}
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT id, name, fide_id FROM players")
        for row in cur:
            if row['fide_id']:
                fide_to_id[row['fide_id']] = row['id']
            name_to_id[row['name'].lower().strip()] = row['id']
    print(f"  {len(fide_to_id) + len(name_to_id):,} player entries loaded")

    # 4. Upsert new players
    print("\n=== Upserting new players ===")
    new_fide = [(k, v) for k, v in players_by_key.items() if k.startswith('fide:') and int(k[5:]) not in fide_to_id]
    new_name = [(k, v) for k, v in players_by_key.items() if k.startswith('name:') and k[5:] not in name_to_id]

    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        for key, p in new_fide:
            cur.execute("""
                INSERT INTO players (name, fide_id, title) VALUES (%s, %s, %s)
                ON CONFLICT (fide_id) DO UPDATE SET title = COALESCE(players.title, EXCLUDED.title)
                RETURNING id, fide_id
            """, (p['name'], p['fide_id'], p['title']))
            row = cur.fetchone()
            if row and row['fide_id']:
                fide_to_id[row['fide_id']] = row['id']
        for key, p in new_name:
            norm = key[5:]
            cur.execute("""
                INSERT INTO players (name, title)
                SELECT %s, %s WHERE NOT EXISTS (SELECT 1 FROM players WHERE LOWER(TRIM(name)) = %s)
                RETURNING id, name
            """, (p['name'], p['title'], norm))
            row = cur.fetchone()
            if row:
                name_to_id[norm] = row['id']
    conn.commit()
    print(f"  Upserted {len(new_fide)} FIDE + {len(new_name)} name-only players")

    # 5. Resolve pairs and upsert
    print("\n=== Upserting opponent pairs ===")
    resolved: list[dict] = []
    skipped = 0
    for pk, data in pair_counts.items():
        key_a, key_b = pk.split('||')
        id_a = fide_to_id.get(int(key_a[5:])) if key_a.startswith('fide:') else name_to_id.get(key_a[5:])
        id_b = fide_to_id.get(int(key_b[5:])) if key_b.startswith('fide:') else name_to_id.get(key_b[5:])
        if not id_a or not id_b:
            skipped += 1
            continue
        small, big = (id_a, id_b) if id_a < id_b else (id_b, id_a)
        resolved.append({'a': small, 'b': big, 'count': data['count'],
                         'first': data['first'], 'last': data['last'],
                         'classical': data['classical'], 'rapid': data['rapid'],
                         'blitz': data['blitz'], 'event': data['event']})

    print(f"  Resolved {len(resolved):,} pairs (skipped {skipped} with missing players)")
    upserted = upsert_pairs(conn, resolved)

    # 6. Update settings and clean up
    max_issue = max(issue for issue, _ in downloaded)
    set_setting(conn, "last_twic_issue", str(max_issue))
    print(f"  Updated last_twic_issue → {max_issue}")

    cleaned = 0
    for _, pgn_path in downloaded:
        if pgn_path.exists():
            pgn_path.unlink()
            cleaned += 1
    print(f"  Cleaned up {cleaned} PGN file(s)")

    print(f"\n=== Done ===")
    print(f"  Issues processed: {len(downloaded)}")
    print(f"  Games parsed:     {total_games:,}")
    print(f"  Pairs upserted:   {upserted:,}")
    conn.close()


if __name__ == "__main__":
    main()
