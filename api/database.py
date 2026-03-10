"""asyncpg connection pool for the FastAPI backend.

Reuses get_db_url() from etl.db so DATABASE_URL handling (SSL, .env.local)
is consistent across the ETL pipeline and the API server.
"""
from __future__ import annotations

import ssl
from typing import Optional

import asyncpg

from etl.db import get_db_url

_pool: Optional[asyncpg.Pool] = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        url = get_db_url()
        # asyncpg doesn't parse sslrootcert=system from the URL — build an
        # explicit SSL context that trusts the OS certificate store instead.
        ssl_ctx: ssl.SSLContext | bool
        if "sslmode=verify-full" in url or "sslrootcert=system" in url:
            ssl_ctx = ssl.create_default_context()
            # Strip the SSL params from the URL so asyncpg doesn't reject them
            url = (
                url.replace("sslrootcert=system", "")
                   .replace("sslmode=verify-full", "")
                   .replace("&&", "&")
                   .rstrip("?&")
            )
        elif "sslmode=require" in url:
            ssl_ctx = True  # asyncpg: require SSL but don't verify cert
            url = url.replace("sslmode=require", "").rstrip("?&")
        else:
            ssl_ctx = False

        _pool = await asyncpg.create_pool(
            url,
            ssl=ssl_ctx,
            min_size=1,
            max_size=5,
            command_timeout=60,
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
