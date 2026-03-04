from __future__ import annotations
"""Pure PGN/ETL utility functions — no DB or filesystem dependencies.

Mirrors lib/pgn-utils.ts exactly so behaviour is identical between the
TypeScript web layer and the Python ETL pipeline.
"""

import re
from datetime import date
from pathlib import Path
from typing import Generator


def parse_header(line: str) -> tuple[str, str] | None:
    """Parse a PGN header line like '[White "Carlsen, Magnus"]'.
    Returns (tag, value) or None for non-header lines.
    """
    m = re.match(r'^\[(\w+)\s+"(.*)"\]$', line)
    return (m.group(1), m.group(2)) if m else None


def normalize_name(name: str) -> str:
    """Ensure a space after the comma in 'Last, First' names."""
    return re.sub(r',([^\s])', r', \1', name).strip()


def normalize_date(raw: str | None) -> str | None:
    """Validate and normalize a PGN date string to 'YYYY-MM-DD'.

    Returns None for:
    - null / empty input
    - question-mark placeholders ("????.??.??")
    - partial dates ("2024.03.??")
    - calendar-invalid dates (Feb 30, Apr 31, Feb 29 in non-leap years)
    """
    if not raw:
        return None
    d = raw.replace('.', '-')
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', d):
        return None
    y, mo, day = map(int, d.split('-'))
    try:
        date(y, mo, day)
    except ValueError:
        return None
    return d


def classify_time_control(tc: str | None, event: str | None) -> str:
    """Classify a game as 'classical', 'rapid', or 'blitz'.

    Logic mirrors classifyTimeControl() in lib/pgn-utils.ts:
    - Event name beats TC string (e.g. "Blitz Championship" → blitz)
    - classical  = effective seconds >= 1500  (base + 40 * increment)
    - rapid      = >= 600 s
    - blitz      = < 600 s
    - Missing/unknown TC → classical (pre-clock-era games)
    - Moves-per-period format (e.g. "40/7200") → classical
    """
    if event and event != '?':
        ev = event.lower()
        if re.search(r'\bblitz\b|\bbullet\b|\blightning\b|\bblindblitz\b|titled.?tue(sday)?', ev):
            return 'blitz'
        if re.search(r'\brapid\b', ev):
            return 'rapid'
    if not tc or tc in ('?', '-', ''):
        return 'classical'
    if re.match(r'^\d+/', tc):
        return 'classical'
    m = re.match(r'^(\d+)(?:\+(\d+))?', tc)
    if not m:
        return 'classical'
    base = int(m.group(1))
    inc = int(m.group(2) or 0)
    effective_secs = base + 40 * inc
    if effective_secs >= 1500:
        return 'classical'
    if effective_secs >= 600:
        return 'rapid'
    return 'blitz'


def stream_pgn(file_path: Path) -> Generator[dict[str, str], None, None]:
    """Yield one header dict per complete game in a PGN file.

    Memory-efficient streaming — never loads the full file into memory.
    Handles Windows CRLF line endings. Skips games where either player
    is unknown ('?') or both players are the same name.
    """
    with open(file_path, encoding='utf-8', errors='replace') as f:
        headers: dict[str, str] = {}
        for line in f:
            line = line.rstrip('\r\n')
            if line.startswith('['):
                result = parse_header(line)
                if result:
                    headers[result[0]] = result[1]
            elif not line.strip() and 'White' in headers and 'Black' in headers:
                w = headers.get('White', '?')
                b = headers.get('Black', '?')
                if w != '?' and b != '?' and w != b:
                    yield headers
                headers = {}
        # Handle last game if file doesn't end with a blank line
        if 'White' in headers and 'Black' in headers:
            w = headers.get('White', '?')
            b = headers.get('Black', '?')
            if w != '?' and b != '?' and w != b:
                yield headers
