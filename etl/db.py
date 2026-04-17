from __future__ import annotations
"""Database connection helpers.

Usage (synchronous):
    from etl.db import get_conn, with_dict_rows
    with get_conn() as conn:
        with conn.cursor(row_factory=with_dict_rows()) as cur:
            cur.execute("SELECT * FROM players")
            rows = cur.fetchall()

Usage (async):
    import asyncpg
    from etl.db import get_db_url
    pool = await asyncpg.create_pool(get_db_url())
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM players")

DATABASE_URL must be set in environment (or .env.local is loaded automatically).
"""

import os
import pathlib
import logging
from contextlib import contextmanager
from typing import Any, Generator

import psycopg
import psycopg.rows

logger = logging.getLogger(__name__)


def _load_database_url() -> str:
    """Load DATABASE_URL from env or .env.local."""
    url = os.environ.get("DATABASE_URL")
    if url:
        return url

    # Try loading .env.local from repo root
    env_file = pathlib.Path(__file__).parent.parent / ".env.local"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line.startswith("DATABASE_URL="):
                url = line.split("=", 1)[1].strip().strip('"').strip("'")
                if url:
                    return url

    raise RuntimeError("DATABASE_URL is not set. Pass it as an env var or put it in .env.local")


def get_db_url() -> str:
    """Get DATABASE_URL with proper SSL settings.

    CockroachDB's sslmode=verify-full needs a CA; on Windows psycopg can't find
    it, so we fall back to the OS trust store. All other providers (Fly,
    Neon, local proxy, …) leave the URL untouched.
    """
    url = _load_database_url()
    if "sslmode=verify-full" in url and "sslrootcert" not in url:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}sslrootcert=system"
    return url


def get_conn(autocommit: bool = False) -> psycopg.Connection:
    """Get a single synchronous database connection."""
    return psycopg.connect(get_db_url(), autocommit=autocommit)


@contextmanager
def with_conn(autocommit: bool = False) -> Generator[psycopg.Connection, None, None]:
    """Context manager for database connections.

    Usage:
        with with_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT ...")
    """
    conn = None
    try:
        conn = get_conn(autocommit=autocommit)
        yield conn
        if not autocommit:
            conn.commit()
    except Exception:
        if conn and not autocommit:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()


def with_dict_rows() -> type[psycopg.rows.DictRow]:
    """Return the DictRow factory for use with cursor().

    Usage:
        with conn.cursor(row_factory=with_dict_rows()) as cur:
            cur.execute("SELECT ...")
            row = cur.fetchone()  # type: dict
    """
    return psycopg.rows.DictRow


def execute_one(sql: str, params: tuple[Any, ...] = ()) -> Any | None:
    """Execute a query and return a single row (or None).

    Useful for quick queries without explicit connection management.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchone()


def execute_all(sql: str, params: tuple[Any, ...] = ()) -> list[Any]:
    """Execute a query and return all rows.

    Useful for quick queries without explicit connection management.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()


def execute_insert(sql: str, params: tuple[Any, ...] = ()) -> Any:
    """Execute an INSERT/UPDATE/DELETE and return the number of affected rows.

    Useful for quick DML without explicit connection management.
    """
    with get_conn(autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.rowcount
