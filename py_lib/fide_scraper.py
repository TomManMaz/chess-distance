"""On-demand FIDE scraper: fetches a player's rated opponents from FIDE's
rating calculation page and upserts them into the database.

Ported from lib/fide-scraper.ts
"""

from __future__ import annotations
import re
import logging
from typing import Any
from urllib.parse import urljoin
import asyncio

try:
    import aiohttp
except ImportError:
    aiohttp = None  # type: ignore

import psycopg
from psycopg import sql

logger = logging.getLogger(__name__)

BASE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

TIMEOUT_SECONDS = 12


async def async_get(
    url: str, extra_headers: dict[str, str] | None = None, timeout: int = TIMEOUT_SECONDS
) -> tuple[str, int, dict[str, str]]:
    """Fetch HTTP GET with timeout and headers. Returns (body, status, headers)."""
    if aiohttp is None:
        raise ImportError("aiohttp is required for async_get. Install with: pip install aiohttp")

    headers = {**BASE_HEADERS, **(extra_headers or {})}
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
                body = await resp.text()
                return body, resp.status, dict(resp.headers)
        except asyncio.TimeoutError:
            raise TimeoutError(f"Request to {url} timed out after {timeout}s")


def _extract_periods(html: str) -> list[str]:
    """Extract FIDE rating period dates from HTML (std/rapid/blitz arrays)."""
    periods = set()
    for m in re.finditer(r"(?:std|rapid|blitz)_array\s*=\s*\[([^\]]+)\]", html):
        for d in re.finditer(r'"(\d{4}-\d{2}-\d{2})"', m.group(1)):
            periods.add(d.group(1))
    return sorted(periods, reverse=True)


def _parse_opponents(html: str, period: str) -> list[dict[str, Any]]:
    """Parse opponent table rows from FIDE calculation page HTML."""
    if not html or "No records found" in html:
        return []

    opponents: list[dict[str, Any]] = []
    for row_match in re.finditer(r"<tr[^>]*>([\s\S]*?)<\/tr>", html, re.IGNORECASE):
        row = row_match.group(1)
        if "id_number=" not in row:
            continue

        # Extract FIDE ID
        fide_match = re.search(r"id_number=(\d+)", row)
        fide_id = int(fide_match.group(1)) if fide_match else None

        # Extract cells
        cells = []
        for cell_match in re.finditer(r"<td[^>]*>([\s\S]*?)<\/td>", row, re.IGNORECASE):
            cell_html = cell_match.group(1)
            cell_text = cell_html
            cell_text = re.sub(r"<[^>]+>", "", cell_text)
            cell_text = cell_text.replace("&amp;", "&").replace("&nbsp;", " ").strip()
            if cell_text:
                cells.append(cell_text)

        if len(cells) < 2:
            continue

        name = cells[0]
        if not name or len(name) < 2 or re.match(r"^\d+$", name):
            continue

        # Extract federation (3 uppercase letters, not ELO/IMP/GMS/RES)
        fed = None
        for cell in cells:
            if re.match(r"^[A-Z]{3}$", cell) and cell not in ("ELO", "IMP", "GMS", "RES"):
                fed = cell
                break

        # Extract title
        title = None
        for cell in cells:
            if re.match(r"^W?(GM|IM|FM|CM|NM)$", cell):
                title = cell
                break

        opponents.append(
            {
                "name": name,
                "fide_id": fide_id,
                "federation": fed,
                "title": title,
                "period": period,
            }
        )

    return opponents


def _extract_player_info(html: str) -> dict[str, str | None]:
    """Extract name, federation, and title from FIDE profile page."""
    # Extract name from <title> or <h1>
    name_match = re.search(r"<title>\s*([^<]+?)\s+FIDE\b", html, re.IGNORECASE)
    if not name_match:
        name_match = re.search(r"<h1[^>]*>\s*([^<]+?)\s*<\/h1>", html, re.IGNORECASE)
    name = name_match.group(1).strip() if name_match else None

    # Extract federation from flag image
    fed_match = re.search(r"flag[_-]([a-z]{3})\.", html, re.IGNORECASE)
    federation = fed_match.group(1).upper() if fed_match else None

    # Extract title
    title_match = re.search(r">\s*(GM|IM|FM|CM|WGM|WIM|WFM|WCM)\s*<", html)
    title = title_match.group(1) if title_match else None

    return {"name": name, "federation": federation, "title": title}


async def _get_periods_and_cookie(fide_id: int) -> tuple[list[str], str]:
    """Fetch rating periods and session cookie from FIDE calculations page."""
    body, _, headers = await async_get(
        f"https://ratings.fide.com/calculations.phtml?id_number={fide_id}",
        extra_headers={"Referer": "https://ratings.fide.com/"},
    )
    periods = _extract_periods(body)

    # Extract cookies
    cookie_header = headers.get("set-cookie", "")
    if isinstance(cookie_header, list):
        cookie_header = "; ".join(cookie_header)
    cookies = [c.split(";")[0].strip() for c in cookie_header.split(", ") if c.strip()]
    cookie = "; ".join(cookies)

    return periods, cookie


async def _fetch_calc(fide_id: int, period: str, t: int, cookie: str) -> str:
    """Fetch individual calculation page for a specific period and time control."""
    url = f"https://ratings.fide.com/a_indv_calculations.php?id_number={fide_id}&rating_period={period}&t={t}"
    try:
        body, _, _ = await async_get(
            url,
            extra_headers={
                "Referer": f"https://ratings.fide.com/calculations.phtml?id_number={fide_id}",
                "X-Requested-With": "XMLHttpRequest",
                **({"Cookie": cookie} if cookie else {}),
            },
        )
        return body
    except Exception as e:
        logger.warning(f"Failed to fetch calc page for {fide_id}/{period}/{t}: {e}")
        return ""


def _find_or_insert_player(
    conn: psycopg.Connection,
    name: str,
    fide_id: int | None,
    federation: str | None,
    title: str | None,
) -> tuple[int, str]:
    """Find player by FIDE ID or fuzzy name match, or insert new player.
    Returns (player_id, player_name).
    """
    with conn.cursor() as cur:
        # 1. Match by FIDE ID
        if fide_id:
            cur.execute("SELECT id, name FROM players WHERE fide_id = %s LIMIT 1", (fide_id,))
            row = cur.fetchone()
            if row:
                return int(row[0]), row[1]

        # 2. Fuzzy name match (trigram similarity)
        cur.execute(
            "SELECT id, name, similarity(name, %s) AS sim FROM players WHERE name %% %s ORDER BY sim DESC LIMIT 1",
            (name, name),
        )
        row = cur.fetchone()
        if row and float(row[2]) > 0.65:
            return int(row[0]), row[1]

        # 3. Insert new player
        cur.execute(
            "INSERT INTO players (name, fide_id, federation, title) VALUES (%s, %s, %s, %s) RETURNING id, name",
            (name, fide_id, federation, title),
        )
        row = cur.fetchone()
        if not row:
            raise RuntimeError(f"Failed to insert player {name}")
        conn.commit()
        return int(row[0]), row[1]


def _link_players(
    conn: psycopg.Connection, id_a: int, id_b: int, period: str, tc_type: int
) -> None:
    """Upsert opponent link between two players."""
    smaller, larger = (id_a, id_b) if id_a < id_b else (id_b, id_a)
    classical_inc = 1 if tc_type == 1 else 0
    rapid_inc = 1 if tc_type == 2 else 0
    blitz_inc = 1 if tc_type == 3 else 0

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO opponents (player_a_id, player_b_id, game_count, first_game_date, last_game_date, classical_count, rapid_count, blitz_count)
            VALUES (%s, %s, 1, %s, %s, %s, %s, %s)
            ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET
              game_count      = GREATEST(opponents.game_count, 1),
              last_game_date  = GREATEST(opponents.last_game_date, EXCLUDED.last_game_date),
              classical_count = GREATEST(opponents.classical_count, EXCLUDED.classical_count),
              rapid_count     = GREATEST(opponents.rapid_count, EXCLUDED.rapid_count),
              blitz_count     = GREATEST(opponents.blitz_count, EXCLUDED.blitz_count)
            """,
            (smaller, larger, period, period, classical_inc, rapid_inc, blitz_inc),
        )
    conn.commit()


async def scrape_fide_player(fide_id: int, conn: psycopg.Connection) -> dict[str, int]:
    """Scrape all rated opponents for a player from FIDE's calculation pages
    and upsert them into the database.

    Returns dict with 'opponents_linked' count.
    """
    logger.info(f"[fide-scraper] Scraping FIDE ID {fide_id}...")

    # 1. Get profile info
    try:
        body, _, _ = await async_get(f"https://ratings.fide.com/profile/{fide_id}")
        info = _extract_player_info(body)
    except Exception as e:
        logger.error(f"Failed to fetch profile for {fide_id}: {e}")
        return {"opponents_linked": 0}

    if not info["name"]:
        logger.warning(f"[fide-scraper] Player {fide_id} not found on FIDE — marking scraped.")
        with conn.cursor() as cur:
            cur.execute("UPDATE players SET fide_scraped_at = NOW() WHERE fide_id = %s", (fide_id,))
        conn.commit()
        return {"opponents_linked": 0}

    logger.info(
        f"[fide-scraper] {info['name']} ({info['federation'] or '?'} {info['title'] or '—'})"
    )

    # 2. Get periods + session cookie
    try:
        periods, cookie = await _get_periods_and_cookie(fide_id)
    except Exception as e:
        logger.error(f"Failed to get periods for {fide_id}: {e}")
        return {"opponents_linked": 0}

    if not periods:
        logger.info(f"[fide-scraper] No rating periods found for {fide_id} — marking scraped.")
        with conn.cursor() as cur:
            cur.execute("UPDATE players SET fide_scraped_at = NOW() WHERE fide_id = %s", (fide_id,))
        conn.commit()
        return {"opponents_linked": 0}

    logger.info(f"[fide-scraper] {len(periods)} periods, newest: {periods[0]}")

    # 3. Collect all unique opponents across periods × time controls
    all_opponents: dict[str, dict[str, Any]] = {}
    for period in periods:
        for t in [1, 2, 3]:
            html = await _fetch_calc(fide_id, period, t, cookie)
            opps = _parse_opponents(html, period)
            for opp in opps:
                key = f"fide:{opp['fide_id']}" if opp["fide_id"] else f"name:{opp['name'].lower().strip()}"
                if key not in all_opponents:
                    all_opponents[key] = {**opp, "tc_types": set()}
                all_opponents[key]["tc_types"].add(t)

    logger.info(f"[fide-scraper] {len(all_opponents)} unique opponents found")

    # 4. Upsert main player
    main_id, main_name = _find_or_insert_player(
        conn, info["name"], fide_id, info["federation"], info["title"]
    )

    # 5. Upsert opponents and edges
    linked = 0
    for opp in all_opponents.values():
        try:
            opp_id, _ = _find_or_insert_player(
                conn, opp["name"], opp["fide_id"], opp["federation"], opp["title"]
            )
            if opp_id == main_id:
                continue
            for tc_type in opp["tc_types"]:
                _link_players(conn, main_id, opp_id, opp["period"], tc_type)
            linked += 1
        except Exception as e:
            logger.warning(f"Failed to link opponent {opp['name']}: {e}")
            continue

    # 6. Mark scraped
    with conn.cursor() as cur:
        cur.execute("UPDATE players SET fide_scraped_at = NOW() WHERE fide_id = %s", (fide_id,))
    conn.commit()

    logger.info(f"[fide-scraper] Done: {main_name} linked to {linked} opponents.")
    return {"opponents_linked": linked}
