/**
 * Convert a DB player name ("Last, First") to a URL slug ("first-last").
 *
 * Algorithm:
 *   1. Split on first comma → last + first
 *   2. Reassemble as "First Last"
 *   3. Lowercase, NFD-normalize, strip accent combining chars
 *   4. Replace non-alphanumeric runs with "-", strip leading/trailing "-"
 *
 * Examples:
 *   "Carlsen, Magnus"       → "carlsen-magnus"
 *   "Tal, Mihail"           → "tal-mihail"
 *   "Nimzowitsch, Aaron "   → "nimzowitsch-aaron"  (trailing space stripped)
 *   "Gragger"               → "gragger"
 *   "Erdős, Pál"            → "erdos-pal"
 */
export function nameToSlug(name: string): string {
  const trimmed = name.trim();
  const commaIdx = trimmed.indexOf(",");
  let full: string;
  if (commaIdx === -1) {
    full = trimmed;
  } else {
    const last = trimmed.slice(0, commaIdx).trim();
    const first = trimmed.slice(commaIdx + 1).trim();
    full = first ? `${first} ${last}` : last;
  }
  return full
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accent combining chars
    .replace(/[^a-z0-9]+/g, "-")     // replace non-alnum runs with hyphen
    .replace(/^-+|-+$/g, "");        // strip leading/trailing hyphens
}
