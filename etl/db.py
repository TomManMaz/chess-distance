from __future__ import annotations
"""Database connection helper.

Usage:
    from etl.db import get_conn
    with get_conn() as conn:
        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute("SELECT ...")

DATABASE_URL must be set in environment (or .env.local is loaded automatically).
"""

import os
import pathlib

import psycopg
import psycopg.rows


def get_conn(autocommit: bool = False) -> psycopg.Connection:
    url = os.environ.get("DATABASE_URL")
    if not url:
        # Try loading .env.local from repo root
        env_file = pathlib.Path(__file__).parent.parent / ".env.local"
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                line = line.strip()
                if line.startswith("DATABASE_URL="):
                    url = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    if not url:
        raise SystemExit("DATABASE_URL is not set. Pass it as an env var or put it in .env.local")
    return psycopg.connect(url, autocommit=autocommit)
