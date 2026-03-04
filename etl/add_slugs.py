"""
etl/add_slugs.py — Populate the `slug` column on the `players` table.

Run once after a fresh ETL load (or re-run at any time — it is idempotent):

    DATABASE_URL=... python etl/add_slugs.py   # Linux/macOS
    # Windows PowerShell:
    $env:DATABASE_URL = "postgresql://..."; python etl/add_slugs.py

Algorithm:
  1. Fetch all players ordered by id.
  2. For each player compute nameToSlug(name).
  3. If the slug collides with one already assigned in this run:
       - Player with FIDE ID → append "-{fide_id}"
       - Player without FIDE ID → append "-2", "-3", … until unique
  4. Batch-UPDATE players SET slug = … in chunks of 1000.

Slug rules (mirror of lib/slug.ts):
  "Carlsen, Magnus"     → "carlsen-magnus"   ← NO, actually first-last:
  "Carlsen, Magnus"     → "magnus-carlsen"
  "Tal, Mihail"         → "mihail-tal"
  "Nimzowitsch, Aaron " → "aaron-nimzowitsch"  (trailing space stripped)
  "Gragger"             → "gragger"
  "Erdős, Pál"          → "pal-erdos"
"""

from __future__ import annotations

import re
import sys
import unicodedata

import psycopg
import psycopg.rows

from etl.db import get_conn


# ---------------------------------------------------------------------------
# Slug algorithm (must match lib/slug.ts exactly)
# ---------------------------------------------------------------------------

def name_to_slug(name: str) -> str:
    name = name.strip()
    comma_idx = name.find(",")
    if comma_idx == -1:
        full = name
    else:
        last = name[:comma_idx].strip()
        first = name[comma_idx + 1:].strip()
        full = f"{first} {last}" if first else last

    # Lowercase + NFD decompose → strip combining chars
    full = full.lower()
    full = unicodedata.normalize("NFD", full)
    full = "".join(c for c in full if unicodedata.category(c) != "Mn")
    # Replace non-alphanumeric runs with hyphen; strip leading/trailing hyphens
    full = re.sub(r"[^a-z0-9]+", "-", full)
    full = full.strip("-")
    return full


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    # Ensure the slug column + index exist (idempotent)
    print("Ensuring slug column exists …")
    with get_conn(autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("ALTER TABLE players ADD COLUMN IF NOT EXISTS slug TEXT")
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS players_slug_idx ON players(slug) WHERE slug IS NOT NULL"
            )
    print("  Column ready.")

    print("Fetching all players …")
    with get_conn() as conn:
        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute("SELECT id, name, fide_id FROM players ORDER BY id")
            players = cur.fetchall()

    print(f"  {len(players):,} players loaded.")

    # Assign slugs with collision handling
    slug_to_id: dict[str, int] = {}
    assignments: list[tuple[str, int]] = []  # (slug, player_id)

    for row in players:
        pid = int(row["id"])
        name = row["name"]
        fide_id = row["fide_id"]

        base = name_to_slug(name)
        if not base:
            base = f"player-{pid}"

        slug = base
        if slug in slug_to_id:
            # Collision — disambiguate
            if fide_id is not None:
                slug = f"{base}-{fide_id}"
            else:
                counter = 2
                while slug in slug_to_id:
                    slug = f"{base}-{counter}"
                    counter += 1

        slug_to_id[slug] = pid
        assignments.append((slug, pid))

    print(f"  {len(assignments):,} slugs computed ({len(slug_to_id):,} unique).")

    # Batch-update in chunks
    CHUNK = 1000
    updated = 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            for i in range(0, len(assignments), CHUNK):
                chunk = assignments[i : i + CHUNK]
                # Build a VALUES list for a bulk UPDATE via executemany
                values = [(slug, pid) for slug, pid in chunk]
                cur.executemany(
                    "UPDATE players SET slug = %s WHERE id = %s",
                    values,
                )
                updated += len(chunk)
                conn.commit()
                print(f"  Updated {updated:,} / {len(assignments):,} …", end="\r")

    print(f"\nDone — {updated:,} players updated with slugs.")


if __name__ == "__main__":
    main()
