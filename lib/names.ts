/**
 * Return the player name in FIDE display format: "Family Name, First Name".
 * The database already stores names in this format, so this function just
 * trims whitespace. Names without a comma (e.g. historical single-name
 * figures like "Morphy" or "Anderssen") are returned unchanged.
 *
 * Examples:
 *   "Carlsen, Magnus"        → "Carlsen, Magnus"
 *   "Tal, Mihail"            → "Tal, Mihail"
 *   "Kasparov, G"            → "Kasparov, G"
 *   "Anderssen"              → "Anderssen"
 */
export function toDisplayName(pgn: string): string {
  return pgn.trim();
}
