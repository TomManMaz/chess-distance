from __future__ import annotations
"""Find and optionally remove cross-era false connections.

A cross-era anomaly: two players whose dated game records are separated
by decades (e.g. one active only before 1910, the other only after 1950).
Also flags FIDE-registered players (post-1970) linked to pre-1910 historical players.

Usage:
    DATABASE_URL=... python etl/validate_data.py           # report only
    DATABASE_URL=... python etl/validate_data.py --fix     # delete anomalous pairs
"""

import argparse
import sys
from pathlib import Path

import psycopg.rows

sys.path.insert(0, str(Path(__file__).parent.parent))
from etl.db import get_conn

PRE_CUTOFF  = "1910-01-01"  # player's last game before this → historical
POST_CUTOFF = "1950-01-01"  # player's first game after this → modern

# Known pre-1900 player DB IDs (Morphy, Anderssen)
PRE1900_ANCHORS = [157633, 157588]
ANCHOR_CUTOFF = "1920-01-01"


def main() -> None:
    parser = argparse.ArgumentParser(description="Find and remove cross-era false connections")
    parser.add_argument("--fix", action="store_true", help="Delete the anomalous pairs")
    args = parser.parse_args()

    conn = get_conn()

    print("\nScanning all opponent pairs for cross-era anomalies (SQL)...")

    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("""
            WITH player_era AS (
                SELECT player_id,
                       MIN(first_game_date) AS first_game,
                       MAX(last_game_date)  AS last_game
                FROM (
                    SELECT player_a_id AS player_id, first_game_date, last_game_date
                    FROM opponents WHERE first_game_date IS NOT NULL
                    UNION ALL
                    SELECT player_b_id AS player_id, first_game_date, last_game_date
                    FROM opponents WHERE first_game_date IS NOT NULL
                ) t
                GROUP BY player_id
            )
            SELECT
                o.player_a_id, o.player_b_id,
                o.game_count, o.first_game_date, o.event_sample,
                pa.name AS name_a, pa.fide_id AS fide_a,
                pb.name AS name_b, pb.fide_id AS fide_b,
                ea.first_game AS era_a_first, ea.last_game AS era_a_last,
                eb.first_game AS era_b_first, eb.last_game AS era_b_last
            FROM opponents o
            JOIN players pa ON pa.id = o.player_a_id
            JOIN players pb ON pb.id = o.player_b_id
            LEFT JOIN player_era ea ON ea.player_id = o.player_a_id
            LEFT JOIN player_era eb ON eb.player_id = o.player_b_id
            WHERE
                (ea.last_game < %s AND eb.first_game > %s)
                OR (eb.last_game < %s AND ea.first_game > %s)
                OR (pa.fide_id IS NOT NULL AND eb.last_game < %s)
                OR (pb.fide_id IS NOT NULL AND ea.last_game < %s)
            ORDER BY ea.last_game NULLS LAST, eb.last_game NULLS LAST
        """, (PRE_CUTOFF, POST_CUTOFF, PRE_CUTOFF, POST_CUTOFF, PRE_CUTOFF, PRE_CUTOFF))
        suspicious = cur.fetchall()

        # Anchor checks (Morphy, Anderssen neighbors with FIDE ID or post-1920 era)
        cur.execute("""
            WITH neighbor_era AS (
                SELECT player_id, MIN(first_game_date) AS first_game
                FROM (
                    SELECT player_a_id AS player_id, first_game_date FROM opponents WHERE first_game_date IS NOT NULL
                    UNION ALL
                    SELECT player_b_id AS player_id, first_game_date FROM opponents WHERE first_game_date IS NOT NULL
                ) t
                GROUP BY player_id
            )
            SELECT
                o.player_a_id, o.player_b_id,
                o.game_count, o.first_game_date, o.event_sample,
                pa.name AS name_a, pa.fide_id AS fide_a,
                pb.name AS name_b, pb.fide_id AS fide_b,
                NULL::timestamptz AS era_a_first, NULL::timestamptz AS era_a_last,
                NULL::timestamptz AS era_b_first, NULL::timestamptz AS era_b_last
            FROM opponents o
            JOIN players pa ON pa.id = o.player_a_id
            JOIN players pb ON pb.id = o.player_b_id
            LEFT JOIN neighbor_era nea ON nea.player_id = o.player_a_id
            LEFT JOIN neighbor_era neb ON neb.player_id = o.player_b_id
            WHERE
                (o.player_a_id = ANY(%s) AND (pb.fide_id IS NOT NULL OR neb.first_game > %s))
                OR (o.player_b_id = ANY(%s) AND (pa.fide_id IS NOT NULL OR nea.first_game > %s))
        """, (PRE1900_ANCHORS, ANCHOR_CUTOFF, PRE1900_ANCHORS, ANCHOR_CUTOFF))
        anchor_suspicious = cur.fetchall()

    # Merge, dedup by pair key
    seen = {f"{r['player_a_id']}:{r['player_b_id']}" for r in suspicious}
    for r in anchor_suspicious:
        key = f"{r['player_a_id']}:{r['player_b_id']}"
        if key not in seen:
            suspicious.append(r)
            seen.add(key)

    if not suspicious:
        print("  No cross-era anomalies found.")
        conn.close()
        return

    print(f"\nFound {len(suspicious)} suspicious pair(s):\n")
    for s in suspicious:
        era_a = str(s['era_a_last'])[:10] if s['era_a_last'] else '?'
        era_b = str(s['era_b_first'])[:10] if s['era_b_first'] else '?'
        print(f"  [{s['player_a_id']} ↔ {s['player_b_id']}] {s['name_a']} / {s['name_b']}")
        print(f"    Games: {s['game_count']}  Event: {s['event_sample'] or '(no event)'}")
        print(f"    Era A last: {era_a}  Era B first: {era_b}")

    if not args.fix:
        print(f"\nRun with --fix to delete these {len(suspicious)} pair(s).")
        conn.close()
        return

    print(f"\nDeleting {len(suspicious)} anomalous pair(s)...")
    with conn.cursor() as cur:
        for s in suspicious:
            cur.execute("DELETE FROM opponents WHERE player_a_id = %s AND player_b_id = %s",
                        (s['player_a_id'], s['player_b_id']))
            print(f"  Deleted: {s['name_a']} ↔ {s['name_b']}")
    conn.commit()
    print("Done.")
    conn.close()


if __name__ == "__main__":
    main()
