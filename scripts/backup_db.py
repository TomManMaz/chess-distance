"""Back up the Chess Distance DB to CSV files.

Uses psycopg's server-side COPY TO STDOUT, which emits standard Postgres CSV
format restorable to *any* Postgres (vanilla, Fly, Cloud SQL, Neon, Supabase)
via ``\\copy FROM`` — no CockroachDB-isms leak through.

Usage:
    conda activate chess-distance-py
    DATABASE_URL="postgresql://..." python scripts/backup_db.py

Writes to: backup/<YYYY-MM-DD-HHMMSS>/ with one CSV per table + a manifest.
"""

from __future__ import annotations

import csv
import datetime as dt
import os
import sys
from pathlib import Path

try:
    import psycopg
except ImportError:
    sys.stderr.write(
        "psycopg not installed. Activate the chess-distance-py conda env:\n"
        "    conda activate chess-distance-py\n"
    )
    sys.exit(1)


# Tables to back up, in restore-safe order (parents before children so FKs resolve).
TABLES = ["players", "opponents", "settings"]


def human_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.stderr.write("DATABASE_URL is not set.\n")
        return 1

    repo_root = Path(__file__).resolve().parent.parent
    stamp = dt.datetime.now().strftime("%Y-%m-%d-%H%M%S")
    out_dir = repo_root / "backup" / stamp
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Backing up to {out_dir}")
    print(f"Source: {url.split('@')[-1]}\n")

    totals: list[tuple[str, int, int]] = []  # (table, rows, bytes)

    with psycopg.connect(url) as conn:
        for table in TABLES:
            csv_path = out_dir / f"{table}.csv"
            # COPY ... TO STDOUT (FORMAT CSV, HEADER) — portable Postgres wire format.
            copy_sql = f"COPY {table} TO STDOUT (FORMAT CSV, HEADER TRUE)"
            print(f"  → {table} … ", end="", flush=True)
            row_count = 0
            with conn.cursor() as cur, open(csv_path, "wb") as f:
                with cur.copy(copy_sql) as copy:
                    for chunk in copy:
                        f.write(chunk)
                # Row count: COPY output doesn't expose rowcount, so ask the DB.
                cur.execute(f"SELECT COUNT(*) FROM {table}")
                row_count = cur.fetchone()[0]
            size = csv_path.stat().st_size
            totals.append((table, row_count, size))
            print(f"{row_count:>10,} rows   {human_bytes(size):>10}")

    # Write a manifest so future-you knows what this backup contains.
    manifest = out_dir / "MANIFEST.txt"
    with manifest.open("w", encoding="utf-8") as f:
        f.write(f"Chess Distance DB backup\n")
        f.write(f"Created: {dt.datetime.now().isoformat(timespec='seconds')}\n")
        f.write(f"Source:  {url.split('@')[-1]}\n\n")
        f.write(f"{'table':<12} {'rows':>12} {'size':>12}\n")
        f.write("-" * 38 + "\n")
        for name, rows, size in totals:
            f.write(f"{name:<12} {rows:>12,} {human_bytes(size):>12}\n")
        total_bytes = sum(s for _, _, s in totals)
        total_rows = sum(r for _, r, _ in totals)
        f.write("-" * 38 + "\n")
        f.write(f"{'total':<12} {total_rows:>12,} {human_bytes(total_bytes):>12}\n")

    total_bytes = sum(s for _, _, s in totals)
    print(f"\n✓ Backup complete: {human_bytes(total_bytes)} total in {out_dir}")
    print(f"  Manifest: {manifest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
