"""
etl/migrate_fide_scraped_at.py — Add fide_scraped_at column to players table.

Run once:
    DATABASE_URL=... python -m etl.migrate_fide_scraped_at
"""

from etl.db import get_conn


def main() -> None:
    print("Adding fide_scraped_at column to players …")
    with get_conn(autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "ALTER TABLE players ADD COLUMN IF NOT EXISTS fide_scraped_at TIMESTAMPTZ DEFAULT NULL"
            )
    print("Done.")


if __name__ == "__main__":
    main()
