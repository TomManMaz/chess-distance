from __future__ import annotations
"""Core ETL: parse all PGN files and upsert opponent pairs into the database.

Reads from:
  data/pgnmentor/   — curated historical/modern player files
  data/pgn/         — TWIC weekly archives
  data/lumbrasgigabase/ — Lumbra's comprehensive OTB game archive

WARNING: TRUNCATEs the opponents table at the start, then rebuilds from scratch.
For incremental updates (new TWIC issues only), use etl/update_twic.py instead.

Usage:
    DATABASE_URL=... python etl/batch_pairs.py
"""

import sys
import time
from pathlib import Path
from collections import defaultdict

import psycopg
import psycopg.rows

sys.path.insert(0, str(Path(__file__).parent.parent))
from etl.db import get_conn
from etl.pgn_utils import normalize_name, normalize_date, classify_time_control, stream_pgn

BATCH_SIZE = 500  # rows per INSERT


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def load_players(conn) -> tuple[dict[int, int], dict[str, int]]:
    """Load all players into two lookup maps: fide_id→db_id and lowercase_name→db_id."""
    fide_to_id: dict[int, int] = {}
    name_to_id: dict[str, int] = {}
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT id, name, fide_id FROM players")
        for row in cur:
            if row['fide_id']:
                fide_to_id[row['fide_id']] = row['id']
            name_to_id[row['name'].lower().strip()] = row['id']
    return fide_to_id, name_to_id


def insert_new_players(conn, new_players: dict, fide_to_id: dict, name_to_id: dict) -> None:
    """Upsert newly discovered players and update the lookup maps."""
    entries = list(new_players.values())
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        for i in range(0, len(entries), 100):
            chunk = entries[i:i + 100]
            placeholders = ','.join(['(%s,%s,%s)'] * len(chunk))
            params: list = []
            for p in chunk:
                params.extend([p['name'], p['fide_id'], p['title']])
            cur.execute(f"""
                INSERT INTO players (name, fide_id, title)
                VALUES {placeholders}
                ON CONFLICT (fide_id) DO UPDATE SET
                    name  = EXCLUDED.name,
                    title = COALESCE(EXCLUDED.title, players.title)
                RETURNING id, name, fide_id
            """, params)
            for row in cur.fetchall():
                if row['fide_id']:
                    fide_to_id[row['fide_id']] = row['id']
                name_to_id[row['name'].lower().strip()] = row['id']
    conn.commit()


def upsert_pairs(conn, pairs: list[dict]) -> int:
    """Batch-upsert opponent pairs with ON CONFLICT accumulation."""
    inserted = 0
    with conn.cursor() as cur:
        for i in range(0, len(pairs), BATCH_SIZE):
            chunk = pairs[i:i + BATCH_SIZE]
            placeholders = ','.join(['(%s,%s,%s,%s::date,%s::date,%s,%s,%s,%s)'] * len(chunk))
            params: list = []
            for p in chunk:
                params.extend([
                    p['a'], p['b'], p['count'],
                    p['first'], p['last'],
                    p['classical'], p['rapid'], p['blitz'],
                    p['event'],
                ])
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
# File collection
# ---------------------------------------------------------------------------

def collect_all_files() -> list[dict]:
    root = Path(__file__).parent.parent / "data"
    files = []

    mentor_dir = root / "pgnmentor"
    if mentor_dir.exists():
        for f in sorted(mentor_dir.glob("*.pgn")):
            files.append({"source": "PGN Mentor", "path": f})

    twic_dir = root / "pgn"
    if twic_dir.exists():
        for f in sorted(twic_dir.glob("*.pgn")):
            files.append({"source": "TWIC", "path": f})

    lumbra_dir = root / "lumbrasgigabase"
    if lumbra_dir.exists():
        for f in sorted(lumbra_dir.rglob("*.pgn")):
            files.append({"source": "Lumbra", "path": f})

    return files


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def resolve_key(key: str, fide_to_id: dict, name_to_id: dict) -> int | None:
    if key.startswith("fide:"):
        return fide_to_id.get(int(key[5:]))
    return name_to_id.get(key[5:])


def main() -> None:
    conn = get_conn()

    all_files = collect_all_files()
    source_counts: dict[str, int] = defaultdict(int)
    for f in all_files:
        source_counts[f['source']] += 1

    print("=== Chess Distance — batch_pairs (Python) ===")
    for src, count in source_counts.items():
        print(f"  {src}: {count} file(s)")
    print(f"  Total: {len(all_files)} PGN files\n")

    # Load all existing players
    print("=== Loading players from DB ===")
    fide_to_id, name_to_id = load_players(conn)
    print(f"  Loaded {len(fide_to_id) + len(name_to_id):,} player entries\n")

    # TRUNCATE once at the start
    print("=== Truncating opponents table ===")
    with conn.cursor() as cur:
        cur.execute("TRUNCATE opponents")
    conn.commit()
    print("  Done\n")

    # Process files one-by-one: parse → upsert → free memory
    print("=== Parsing and upserting (file by file) ===")
    total_games = 0
    total_pairs = 0
    last_source = None

    for file_num, file in enumerate(all_files, 1):
        if file['source'] != last_source:
            print(f"\n  [{file['source']}]")
            last_source = file['source']

        size_mb = file['path'].stat().st_size // (1024 * 1024)
        label = file['path'].name
        print(f"    ({file_num}/{len(all_files)}) {label} ({size_mb} MB)... ", end="", flush=True)
        t0 = time.time()

        new_players: dict[str, dict] = {}
        pair_counts: dict[str, dict] = {}
        file_games = 0

        for g in stream_pgn(file['path']):
            file_games += 1
            total_games += 1

            w_fide = int(g['WhiteFideId']) if g.get('WhiteFideId', '').strip().isdigit() else None
            b_fide = int(g['BlackFideId']) if g.get('BlackFideId', '').strip().isdigit() else None
            w_name = normalize_name(g['White'])
            b_name = normalize_name(g['Black'])
            w_key = f"fide:{w_fide}" if w_fide else f"name:{w_name.lower()}"
            b_key = f"fide:{b_fide}" if b_fide else f"name:{b_name.lower()}"

            if not resolve_key(w_key, fide_to_id, name_to_id) and w_key not in new_players:
                new_players[w_key] = {'name': w_name, 'fide_id': w_fide, 'title': g.get('WhiteTitle') or None}
            if not resolve_key(b_key, fide_to_id, name_to_id) and b_key not in new_players:
                new_players[b_key] = {'name': b_name, 'fide_id': b_fide, 'title': g.get('BlackTitle') or None}

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
                    'count': 1,
                    'first': game_date, 'last': game_date,
                    'classical': 1 if tc == 'classical' else 0,
                    'rapid':     1 if tc == 'rapid'     else 0,
                    'blitz':     1 if tc == 'blitz'     else 0,
                    'event': event_name,
                }

        # Insert new players, update maps
        if new_players:
            insert_new_players(conn, new_players, fide_to_id, name_to_id)

        # Resolve pairs to DB IDs
        resolved: list[dict] = []
        skipped = 0
        for pk, data in pair_counts.items():
            key_a, key_b = pk.split('||')
            id_a = resolve_key(key_a, fide_to_id, name_to_id)
            id_b = resolve_key(key_b, fide_to_id, name_to_id)
            if not id_a or not id_b:
                skipped += 1
                continue
            small, big = (id_a, id_b) if id_a < id_b else (id_b, id_a)
            resolved.append({
                'a': small, 'b': big,
                'count': data['count'],
                'first': data['first'], 'last': data['last'],
                'classical': data['classical'],
                'rapid':     data['rapid'],
                'blitz':     data['blitz'],
                'event':     data['event'],
            })

        inserted = upsert_pairs(conn, resolved)
        total_pairs += inserted

        elapsed = time.time() - t0
        skip_note = f" [{skipped} skipped]" if skipped else ""
        print(f"{file_games:,} games, {inserted:,} pairs ({elapsed:.1f}s){skip_note}")

    # Final stats
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT COUNT(*) AS n FROM opponents")
        final_count = cur.fetchone()['n']

    print(f"\n=== DONE ===")
    print(f"  Total games parsed:     {total_games:,}")
    print(f"  Total pairs upserted:   {total_pairs:,}")
    print(f"  Opponent pairs in DB:   {final_count:,}")
    conn.close()


if __name__ == "__main__":
    main()
