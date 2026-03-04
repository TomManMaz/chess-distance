"""Slug generation and name utilities.

Ported from lib/slug.ts and lib/names.ts
"""

from __future__ import annotations
import unicodedata
import re


def to_display_name(pgn: str) -> str:
    """Return the player name in FIDE display format: 'Family Name, First Name'.

    The database already stores names in this format, so this function just
    trims whitespace. Names without a comma (e.g. historical single-name
    figures like 'Morphy' or 'Anderssen') are returned unchanged.

    Examples:
        'Carlsen, Magnus'        → 'Carlsen, Magnus'
        'Tal, Mihail'            → 'Tal, Mihail'
        'Kasparov, G'            → 'Kasparov, G'
        'Anderssen'              → 'Anderssen'
    """
    return pgn.strip()


def name_to_slug(name: str) -> str:
    """Convert a DB player name ('Last, First') to a URL slug ('first-last').

    Algorithm:
        1. Split on first comma → last + first
        2. Reassemble as 'First Last'
        3. Lowercase, NFD-normalize, strip accent combining chars
        4. Replace non-alphanumeric runs with '-', strip leading/trailing '-'

    Examples:
        'Carlsen, Magnus'       → 'carlsen-magnus'
        'Tal, Mihail'           → 'tal-mihail'
        'Nimzowitsch, Aaron '   → 'nimzowitsch-aaron'  (trailing space stripped)
        'Gragger'               → 'gragger'
        'Erdős, Pál'            → 'erdos-pal'
    """
    trimmed = name.strip()
    comma_idx = trimmed.find(",")

    if comma_idx == -1:
        full = trimmed
    else:
        last = trimmed[:comma_idx].strip()
        first = trimmed[comma_idx + 1 :].strip()
        full = f"{first} {last}" if first else last

    # Lowercase
    full = full.lower()
    # NFD normalize and strip accents
    full = unicodedata.normalize("NFD", full)
    full = "".join(c for c in full if unicodedata.category(c) != "Mn")
    # Replace non-alphanumeric runs with hyphen
    full = re.sub(r"[^a-z0-9]+", "-", full)
    # Strip leading/trailing hyphens
    full = re.sub(r"^-+|-+$", "", full)

    return full


def slug_to_name_parts(slug: str) -> tuple[str, str] | None:
    """Convert a slug back to (first, last) parts.

    This is a heuristic: if there's only one part, return (part, '').
    If multiple parts, assume the last part is the surname.

    Examples:
        'carlsen-magnus'  → ('Magnus', 'Carlsen')
        'gragger'         → ('', 'Gragger')

    Returns None if the slug is empty.
    """
    if not slug:
        return None
    parts = slug.split("-")
    if len(parts) == 1:
        return ("", parts[0])
    # Last part is surname, rest is first name
    surname = parts[-1]
    first_parts = parts[:-1]
    first = " ".join(first_parts)
    return (first, surname) if first else ("", surname)
