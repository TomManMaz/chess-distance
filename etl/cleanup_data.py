from __future__ import annotations
"""Remove dummy/placeholder players that create false connections.

Deletes players named 'NN', 'Computer', 'Comp *', 'Team *', etc., along
with all their opponent pairs.

Usage:
    DATABASE_URL=... python etl/cleanup_data.py
"""

import sys
from pathlib import Path

import psycopg.rows

sys.path.insert(0, str(Path(__file__).parent.parent))
from etl.db import get_conn


def main() -> None:
    conn = get_conn()
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("""
            SELECT id, name FROM players
            WHERE name IN ('NN', 'N.N.', 'N.N', '?', '??', 'Unknown', 'unknown', 'Comp', 'Computer')
               OR name LIKE 'Comp %%'
               OR name LIKE 'Team %%'
        """)
        dummies = cur.fetchall()

    print(f"Found {len(dummies)} dummy players to remove:")
    for d in dummies:
        print(f"  {d['id']}: \"{d['name']}\"")

    if dummies:
        with conn.cursor() as cur:
            for d in dummies:
                cur.execute("DELETE FROM opponents WHERE player_a_id = %s OR player_b_id = %s", (d['id'], d['id']))
                cur.execute("DELETE FROM players WHERE id = %s", (d['id'],))
                print(f"  Deleted pairs and player {d['id']}")
        conn.commit()
        print(f"Removed {len(dummies)} dummy players and their connections")

    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT (SELECT count(*) FROM players) AS p, (SELECT count(*) FROM opponents) AS o")
        stats = cur.fetchone()
    print(f"\nRemaining: {stats['p']:,} players, {stats['o']:,} opponent pairs")
    conn.close()


if __name__ == "__main__":
    main()
