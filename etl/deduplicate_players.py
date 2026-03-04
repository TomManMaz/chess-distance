from __future__ import annotations
"""Merge duplicate player rows in three phases.

  Phase 0: Delete corrupted names (colon-joined parsing artifacts)
  Phase 1: Exact duplicates (same LOWER(TRIM(name)))
  Phase 2: Abbreviated-name duplicates ("Kasparov, G" → "Kasparov, Garry")

Always keep the longer (fuller) name as canonical; transfer fide_id,
title, and federation from the dropped row if the kept row lacks them.

Usage:
    DATABASE_URL=... python etl/deduplicate_players.py
    DATABASE_URL=... python etl/deduplicate_players.py --dry-run
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


# ---------------------------------------------------------------------------
# merge_into: point all opponent edges from drop_id → keep_id, then delete
# ---------------------------------------------------------------------------

def merge_into(conn, keep_id: int, drop_id: int) -> None:
    import psycopg.rows
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        # Inherit title / federation / fide_id from dropped row if canonical lacks them
        cur.execute("""
            UPDATE players
            SET
                title      = COALESCE(players.title,      (SELECT title      FROM players WHERE id = %s)),
                federation = COALESCE(players.federation, (SELECT federation FROM players WHERE id = %s)),
                fide_id    = COALESCE(players.fide_id,    (SELECT fide_id    FROM players WHERE id = %s))
            WHERE id = %s
        """, (drop_id, drop_id, drop_id, keep_id))

        # Fetch all opponent rows involving drop_id
        cur.execute("""
            SELECT player_a_id, player_b_id, game_count, first_game_date, last_game_date,
                   classical_count, rapid_count, blitz_count, event_sample
            FROM opponents
            WHERE player_a_id = %s OR player_b_id = %s
        """, (drop_id, drop_id))
        rows = cur.fetchall()

    for row in rows:
        other_id = row['player_b_id'] if row['player_a_id'] == drop_id else row['player_a_id']

        # Delete the old row first (avoids PK conflicts)
        with conn.cursor() as cur:
            cur.execute("DELETE FROM opponents WHERE player_a_id = %s AND player_b_id = %s",
                        (row['player_a_id'], row['player_b_id']))

        # Self-loop: skip
        if other_id == keep_id:
            continue

        new_a, new_b = (keep_id, other_id) if keep_id < other_id else (other_id, keep_id)

        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO opponents (
                    player_a_id, player_b_id, game_count,
                    first_game_date, last_game_date,
                    classical_count, rapid_count, blitz_count, event_sample
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET
                    game_count      = opponents.game_count      + EXCLUDED.game_count,
                    first_game_date = LEAST(opponents.first_game_date, EXCLUDED.first_game_date),
                    last_game_date  = GREATEST(opponents.last_game_date, EXCLUDED.last_game_date),
                    classical_count = opponents.classical_count + EXCLUDED.classical_count,
                    rapid_count     = opponents.rapid_count     + EXCLUDED.rapid_count,
                    blitz_count     = opponents.blitz_count     + EXCLUDED.blitz_count,
                    event_sample    = COALESCE(opponents.event_sample, EXCLUDED.event_sample)
            """, (new_a, new_b, row['game_count'],
                  row['first_game_date'], row['last_game_date'],
                  row['classical_count'] or 0, row['rapid_count'] or 0,
                  row['blitz_count'] or 0, row['event_sample']))

    with conn.cursor() as cur:
        cur.execute("DELETE FROM players WHERE id = %s", (drop_id,))
    conn.commit()


def pick_canonical(players: list[dict]) -> dict:
    """Choose which player survives: prefer FIDE ID → more games → longer name."""
    def score(p):
        return (1 if p['fide_id'] else 0, p['total_games'], len(p['name']))
    return max(players, key=score)


# ---------------------------------------------------------------------------
# Phase 0: Delete colon-artifact names
# ---------------------------------------------------------------------------

def phase0_corrupted(conn, dry_run: bool) -> int:
    import psycopg.rows
    print("\n=== Phase 0: Corrupted name entries (colon artifacts) ===")
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT id, name FROM players WHERE name LIKE '%:%' ORDER BY name")
        corrupt = cur.fetchall()
    print(f"  Found {len(corrupt)} corrupted entries")

    for p in corrupt:
        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute("SELECT COUNT(*) AS n FROM opponents WHERE player_a_id = %s OR player_b_id = %s",
                        (p['id'], p['id']))
            pair_count = cur.fetchone()['n']

        if dry_run:
            print(f"  [DRY-RUN] Delete \"{p['name']}\" (id={p['id']}, {pair_count} opponent pairs)")
        else:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM opponents WHERE player_a_id = %s OR player_b_id = %s", (p['id'], p['id']))
                cur.execute("DELETE FROM players WHERE id = %s", (p['id'],))
            conn.commit()
            print(f"  Deleted \"{p['name']}\" ({pair_count} pairs removed)")

    return len(corrupt)


# ---------------------------------------------------------------------------
# Phase 1: Exact duplicates
# ---------------------------------------------------------------------------

def phase1_exact(conn, dry_run: bool) -> int:
    import psycopg.rows
    print("\n=== Phase 1: Exact duplicates ===")
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("""
            SELECT
                LOWER(TRIM(p.name)) AS norm,
                json_agg(json_build_object(
                    'id', p.id, 'name', p.name, 'fide_id', p.fide_id,
                    'total_games', COALESCE((
                        SELECT SUM(game_count) FROM opponents
                        WHERE player_a_id = p.id OR player_b_id = p.id
                    ), 0)
                )) AS players
            FROM players p
            GROUP BY LOWER(TRIM(p.name))
            HAVING COUNT(*) > 1
            ORDER BY LOWER(TRIM(p.name))
        """)
        groups = cur.fetchall()

    print(f"  Found {len(groups)} exact-duplicate groups")
    merged = 0

    for group in groups:
        players = group['players']
        canonical = pick_canonical(players)
        for dup in players:
            if dup['id'] == canonical['id']:
                continue
            if dry_run:
                print(f"  [DRY-RUN] Merge \"{dup['name']}\" (id={dup['id']}) → \"{canonical['name']}\" (id={canonical['id']})")
            else:
                print(f"  Merging \"{dup['name']}\" → \"{canonical['name']}\" ...", end="", flush=True)
                merge_into(conn, canonical['id'], dup['id'])
                print(" done")
            merged += 1

    print(f"  Merged {merged} exact duplicates")
    return merged


# ---------------------------------------------------------------------------
# Phase 2: Abbreviated-name duplicates
# ---------------------------------------------------------------------------

def phase2_abbreviated(conn, dry_run: bool) -> int:
    import psycopg.rows
    print("\n=== Phase 2: Abbreviated/truncated-name duplicates ===")
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("""
            SELECT p.id, p.name, p.fide_id,
                COALESCE((
                    SELECT SUM(game_count) FROM opponents
                    WHERE player_a_id = p.id OR player_b_id = p.id
                ), 0) AS total_games
            FROM players p ORDER BY p.name
        """)
        all_players = cur.fetchall()

    print(f"  Loaded {len(all_players):,} players from DB")

    # Group by last name (text before first comma)
    by_last_name: dict[str, list[dict]] = {}
    for p in all_players:
        comma = p['name'].find(',')
        if comma == -1:
            continue
        last = p['name'][:comma].strip().lower()
        first = p['name'][comma + 1:].strip()
        if not first:
            continue
        by_last_name.setdefault(last, []).append({**p, 'first_name': first})

    merged = 0
    ambiguous = 0

    for players in by_last_name.values():
        if len(players) < 2:
            continue
        # Sort by first name length ascending (shorter = more abbreviated = processed first)
        sorted_players = sorted(players, key=lambda p: len(p['first_name']))
        dropped: set[int] = set()

        for player in sorted_players:
            if player['id'] in dropped or ':' in player['name']:
                continue
            first_norm = player['first_name'].rstrip('. ').upper()
            if not first_norm:
                continue

            matches = [
                q for q in players
                if q['id'] != player['id']
                and q['id'] not in dropped
                and ':' not in q['name']
                and q['first_name'].upper().startswith(first_norm)
                and len(q['first_name']) > len(player['first_name'])
            ]

            if not matches:
                continue
            if len(matches) > 1:
                ambiguous += 1
                if dry_run:
                    names = ', '.join(f'"{m["name"]}"' for m in matches)
                    print(f"  [AMBIGUOUS] \"{player['name']}\" matches {names}")
                continue

            # Exactly one match — always keep the longer (fuller) name
            canonical = matches[0]
            if dry_run:
                print(f"  [DRY-RUN] Merge \"{player['name']}\" (id={player['id']}) → \"{canonical['name']}\" (id={canonical['id']})")
            else:
                print(f"  Merging \"{player['name']}\" → \"{canonical['name']}\" ...", end="", flush=True)
                merge_into(conn, canonical['id'], player['id'])
                print(" done")
            merged += 1
            dropped.add(player['id'])

    print(f"  Merged {merged} abbreviated/truncated duplicates")
    print(f"  Skipped {ambiguous} ambiguous cases")
    return merged


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    from etl.db import get_conn
    import psycopg.rows

    parser = argparse.ArgumentParser(description="Deduplicate player rows")
    parser.add_argument("--dry-run", action="store_true", help="Report only, make no DB changes")
    args = parser.parse_args()

    conn = get_conn()

    if args.dry_run:
        print("*** DRY-RUN MODE — no changes will be made ***")

    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT (SELECT count(*) FROM players) AS p, (SELECT count(*) FROM opponents) AS o")
        before = cur.fetchone()
    print(f"Before: {before['p']:,} players, {before['o']:,} opponent pairs")

    corrupt  = phase0_corrupted(conn, args.dry_run)
    exact    = phase1_exact(conn, args.dry_run)
    abbrev   = phase2_abbreviated(conn, args.dry_run)

    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT (SELECT count(*) FROM players) AS p, (SELECT count(*) FROM opponents) AS o")
        after = cur.fetchone()

    print(f"\n=== Summary ===")
    print(f"  Corrupted entries deleted:     {corrupt}")
    print(f"  Exact duplicates merged:       {exact}")
    print(f"  Abbreviated duplicates merged: {abbrev}")
    print(f"  Total:                         {corrupt + exact + abbrev}")
    if not args.dry_run:
        print(f"\nBefore: {before['p']:,} players, {before['o']:,} opponent pairs")
        print(f"After:  {after['p']:,} players, {after['o']:,} opponent pairs")
    conn.close()


if __name__ == "__main__":
    main()
