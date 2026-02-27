/**
 * Convert a PGN-style "Last, First" name to display order "First Last".
 * If there is no comma (single-word names, historical figures with one name)
 * the string is returned unchanged.
 *
 * Examples:
 *   "Carlsen, Magnus"        → "Magnus Carlsen"
 *   "Tal, Mihail"            → "Mihail Tal"
 *   "Short, Nigel D"         → "Nigel D Short"
 *   "Kasparov, G"            → "G Kasparov"
 *   "Bird, Henry Edward"     → "Henry Edward Bird"
 *   "Anderssen"              → "Anderssen"   (no comma)
 */
export function toDisplayName(pgn: string): string {
  const comma = pgn.indexOf(",");
  if (comma === -1) return pgn;
  const last  = pgn.slice(0, comma).trim();
  const first = pgn.slice(comma + 1).trim();
  return first ? `${first} ${last}` : last;
}
