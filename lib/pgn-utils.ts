/**
 * Pure utility functions shared by batch-pairs.js and tests.
 * No DB or filesystem dependencies.
 */

export function parseHeader(line: string): [string, string] | null {
  const m = line.match(/^\[(\w+)\s+"(.*)"\]$/);
  return m ? [m[1], m[2]] : null;
}

export function normalizeName(name: string): string {
  return name.replace(/,([^\s])/, ", $1").trim();
}

/**
 * Validate and normalize a PGN date string.
 * Returns "YYYY-MM-DD" or null. Rejects invalid calendar dates like Feb 30.
 */
export function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\./g, "-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const [y, mo, day] = d.split("-").map(Number);
  const dt = new Date(y, mo - 1, day);
  if (dt.getFullYear() !== y || dt.getMonth() + 1 !== mo || dt.getDate() !== day) return null;
  return d;
}

export function classifyTimeControl(
  tc: string | null | undefined,
  event: string | null | undefined
): "classical" | "rapid" | "blitz" {
  if (event && event !== "?") {
    const ev = event.toLowerCase();
    if (/\bblitz\b|\bbullet\b|\blightning\b|\bblindblitz\b|titled.?tue(sday)?/.test(ev)) return "blitz";
    if (/\brapid\b/.test(ev)) return "rapid";
  }
  if (!tc || tc === "?" || tc === "-" || tc === "") return "classical";
  if (/^\d+\//.test(tc)) return "classical";
  const m = tc.match(/^(\d+)(?:\+(\d+))?/);
  if (!m) return "classical";
  const base = parseInt(m[1]);
  const inc = parseInt(m[2] || "0");
  const effectiveSecs = base + 40 * inc;
  if (effectiveSecs >= 1500) return "classical";
  if (effectiveSecs >= 600) return "rapid";
  return "blitz";
}
