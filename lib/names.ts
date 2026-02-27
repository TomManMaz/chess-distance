/**
 * Convert a PGN-style "Last, First" name to display order "First Last".
 * If there is no comma (single-word names, historical figures with one name)
 * the string is returned unchanged.
 *
 * Single-letter initials (e.g. "Kasparov, G") are suppressed — only the last
 * name is shown — because a bare initial looks worse than no first name at all.
 *
 * Examples:
 *   "Carlsen, Magnus"        → "Magnus Carlsen"
 *   "Tal, Mihail"            → "Mihail Tal"
 *   "Short, Nigel D"         → "Nigel D Short"
 *   "Kasparov, G"            → "Kasparov"      (initial suppressed)
 *   "Bird, Henry Edward"     → "Henry Edward Bird"
 *   "Anderssen"              → "Anderssen"      (no comma)
 */
export function toDisplayName(pgn: string): string {
  const comma = pgn.indexOf(",");
  if (comma === -1) return pgn;
  const last  = pgn.slice(0, comma).trim();
  const first = pgn.slice(comma + 1).trim();
  if (!first) return last;
  // Suppress bare single-letter initials (with or without trailing period)
  if (/^[A-Za-z]\.?$/.test(first)) return last;
  return `${first} ${last}`;
}
