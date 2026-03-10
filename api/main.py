"""FastAPI backend for Chess Distance — parallel to the Next.js /api routes.

Runs as a persistent process so the graph stays in memory between requests,
eliminating the cold-start problem that affects Vercel serverless functions.

Routes (all under /api/v2/):
  GET /api/v2/distance?from=<id>&to=<id>[&tc=classical]  — SSE stream
  GET /api/v2/search?q=<query>                            — player autocomplete
  GET /api/v2/stats                                        — DB statistics
  GET /api/v2/games?a=<id>&b=<id>                         — edge metadata

Start locally:
  uvicorn api.main:app --reload --port 8001

Deploy on Railway:
  Set DATABASE_URL env var; Railway auto-builds via Dockerfile.api.
"""
from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from api.database import close_pool, get_pool
from api.graph import find_shortest_path, is_cache_warm


# ─── App lifecycle ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await close_pool()


app = FastAPI(
    title="Chess Distance API v2",
    description="Shortest opponent path between chess players.",
    version="2.0.0",
    lifespan=lifespan,
)

# Allow requests from the Vercel frontend (and localhost for development)
_allowed_origins = [
    "https://chess-distance.vercel.app",
    "http://localhost:3000",
    "http://localhost:3457",
]
if extra := os.environ.get("CORS_ORIGIN"):
    _allowed_origins.append(extra)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ─── SSE helper ────────────────────────────────────────────────────────────────

def sse_event(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/api/v2/distance")
async def distance(
    from_id: int = Query(..., alias="from"),
    to_id:   int = Query(..., alias="to"),
    tc:      str = Query("all"),
):
    """Stream the shortest opponent path as Server-Sent Events.

    Events: status (progress text), result (JSON path), error (JSON error).
    """
    tc_filter = "classical" if tc == "classical" else "all"

    async def stream():
        pool = await get_pool()

        async def send_status(msg: str):
            yield sse_event("status", msg)

        # Tell the client immediately whether it's a cold start
        yield sse_event("status", "Searching for shortest path…" if is_cache_warm()
                                  else "Loading game graph…")

        # Collect status events from graph loading
        status_events: list[str] = []

        async def on_status(msg: str):
            status_events.append(msg)

        try:
            result = await find_shortest_path(pool, from_id, to_id, tc_filter, on_status)

            # Replay any status events collected during loading
            for msg in status_events:
                yield sse_event("status", msg)

            if result is None:
                error = (
                    "No path found through classical games only. Try disabling the filter."
                    if tc_filter == "classical"
                    else "No path found between these players"
                )
                yield sse_event("error", json.dumps({"error": error, "tcFiltered": tc_filter == "classical"}))
            else:
                yield sse_event("result", json.dumps(result))
        except Exception as exc:
            yield sse_event("error", json.dumps({"error": "An error occurred. Please try again."}))
            raise exc

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/v2/search")
async def search(q: str = Query(..., min_length=1)):
    """Fuzzy player name search using trigram similarity (pg_trgm)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        # Try FIDE ID lookup first
        if q.isdigit():
            rows = await conn.fetch(
                "SELECT id, name, title, federation FROM players "
                "WHERE fide_id = $1 LIMIT 10",
                int(q),
            )
        else:
            rows = await conn.fetch(
                "SELECT id, name, title, federation FROM players "
                "WHERE name % $1 "
                "ORDER BY similarity(name, $1) DESC LIMIT 10",
                q,
            )
    return [
        {"id": int(r["id"]), "name": r["name"], "title": r["title"], "federation": r["federation"]}
        for r in rows
    ]


@app.get("/api/v2/stats")
async def stats():
    """Database statistics: player count, game count, pair count, last update."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT
                (SELECT COUNT(*) FROM players)       AS total_players,
                (SELECT COUNT(*) FROM opponents)     AS total_opponent_pairs,
                (SELECT SUM(game_count) FROM opponents) AS total_games,
                (SELECT value FROM settings WHERE key = 'last_twic_issue_date' LIMIT 1)
                    AS last_updated
        """)
    return {
        "total_players":       int(row["total_players"]),
        "total_opponent_pairs": int(row["total_opponent_pairs"]),
        "total_games":         int(row["total_games"] or 0),
        "last_updated":        row["last_updated"],
        "graph_warm":          is_cache_warm(),
    }


@app.get("/api/v2/games")
async def games(a: int, b: int):
    """Return edge metadata between two players (game counts, dates, sample events)."""
    pool = await get_pool()
    a_key, b_key = min(a, b), max(a, b)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT game_count, classical_count, rapid_count, blitz_count, "
            "first_game_date, last_game_date, event_sample "
            "FROM opponents WHERE player_a_id = $1 AND player_b_id = $2",
            a_key, b_key,
        )
    if not row:
        raise HTTPException(status_code=404, detail="No games found between these players")
    return {
        "game_count":      int(row["game_count"]),
        "classical_count": int(row["classical_count"] or 0),
        "rapid_count":     int(row["rapid_count"] or 0),
        "blitz_count":     int(row["blitz_count"] or 0),
        "first_game_date": str(row["first_game_date"]) if row["first_game_date"] else None,
        "last_game_date":  str(row["last_game_date"])  if row["last_game_date"]  else None,
        "event_sample":    row["event_sample"],
    }


@app.get("/api/v2/health")
async def health():
    return {"status": "ok", "graph_warm": is_cache_warm()}
