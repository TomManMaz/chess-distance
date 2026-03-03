/**
 * On-demand FIDE scraper: fetches a player's rated opponents from FIDE's
 * rating calculation page and upserts them into the database.
 *
 * Ported from scripts/add-player-fide.js.
 */

import https from "https";
import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

const BASE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

interface HttpResult {
  body: string;
  status: number;
  headers: Record<string, string | string[]>;
}

function get(url: string, extraHeaders: Record<string, string> = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https
      .get(
        {
          hostname: u.hostname,
          path: u.pathname + u.search,
          headers: { ...BASE_HEADERS, ...extraHeaders },
        },
        (res) => {
          let body = "";
          res.on("data", (c: Buffer) => (body += c));
          res.on("end", () =>
            resolve({
              body,
              status: res.statusCode ?? 0,
              headers: res.headers as Record<string, string | string[]>,
            })
          );
        }
      )
      .on("error", reject)
      .setTimeout(12000, function (this: { destroy: (e: Error) => void }) {
        this.destroy(new Error("request timeout"));
      });
  });
}

function extractPeriods(html: string): string[] {
  const periods = new Set<string>();
  for (const m of html.matchAll(/(?:std|rapid|blitz)_array\s*=\s*\[([^\]]+)\]/g)) {
    for (const d of m[1].matchAll(/"(\d{4}-\d{2}-\d{2})"/g)) {
      periods.add(d[1]);
    }
  }
  return [...periods].sort().reverse();
}

interface OpponentEntry {
  name: string;
  fide_id: number | null;
  federation: string | null;
  title: string | null;
  period: string;
  tcTypes: Set<number>;
}

function parseOpponents(html: string, period: string): Omit<OpponentEntry, "tcTypes">[] {
  if (!html || html.includes("No records found")) return [];

  const opponents: Omit<OpponentEntry, "tcTypes">[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const row = m[1];
    if (!row.includes("id_number=")) continue;

    const fideMatch = row.match(/id_number=(\d+)/);
    const fideId = fideMatch ? parseInt(fideMatch[1]) : null;

    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((c) =>
        c[1]
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&nbsp;/g, " ")
          .trim()
      )
      .filter(Boolean);

    if (cells.length < 2) continue;
    const name = cells[0];
    if (!name || name.length < 2 || /^\d+$/.test(name)) continue;

    const fed = cells.find((c) => /^[A-Z]{3}$/.test(c) && !["ELO", "IMP", "GMS", "RES"].includes(c)) ?? null;
    const title = cells.find((c) => /^W?(GM|IM|FM|CM|NM)$/.test(c)) ?? null;

    opponents.push({ name, fide_id: fideId, federation: fed, title, period });
  }
  return opponents;
}

async function getPlayerInfo(
  fideId: number
): Promise<{ name: string | null; federation: string | null; title: string | null }> {
  const { body } = await get(`https://ratings.fide.com/profile/${fideId}`);
  const nameMatch =
    body.match(/<title>\s*([^<]+?)\s+FIDE\b/i) ||
    body.match(/<h1[^>]*>\s*([^<]+?)\s*<\/h1>/i);
  const name = nameMatch ? nameMatch[1].trim() : null;
  const fedMatch = body.match(/flag[_-]([a-z]{3})\./i);
  const federation = fedMatch ? fedMatch[1].toUpperCase() : null;
  const titleMatch = body.match(/>\s*(GM|IM|FM|CM|WGM|WIM|WFM|WCM)\s*</);
  const title = titleMatch ? titleMatch[1] : null;
  return { name, federation, title };
}

async function getPeriodsAndCookie(
  fideId: number
): Promise<{ periods: string[]; cookie: string }> {
  const { body, headers } = await get(
    `https://ratings.fide.com/calculations.phtml?id_number=${fideId}`,
    { Referer: "https://ratings.fide.com/" }
  );
  const rawCookies = headers["set-cookie"];
  const cookieArr = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
  const cookie = cookieArr.map((c: string) => c.split(";")[0]).join("; ");
  const periods = extractPeriods(body);
  return { periods, cookie };
}

async function fetchCalc(
  fideId: number,
  period: string,
  t: number,
  cookie: string
): Promise<string> {
  const url = `https://ratings.fide.com/a_indv_calculations.php?id_number=${fideId}&rating_period=${period}&t=${t}`;
  try {
    const { body } = await get(url, {
      Referer: `https://ratings.fide.com/calculations.phtml?id_number=${fideId}`,
      "X-Requested-With": "XMLHttpRequest",
      ...(cookie ? { Cookie: cookie } : {}),
    });
    return body;
  } catch {
    return "";
  }
}

async function findOrInsertPlayer(
  sql: Sql,
  name: string,
  fideId: number | null,
  federation: string | null,
  title: string | null
): Promise<{ id: number; name: string }> {
  // 1. Match by FIDE ID
  if (fideId) {
    const r = await sql<{ id: number; name: string }[]>`
      SELECT id, name FROM players WHERE fide_id = ${fideId}
    `;
    if (r.length) return r[0];
  }
  // 2. Fuzzy name match
  const r = await sql<{ id: number; name: string; sim: number }[]>`
    SELECT id, name, similarity(name, ${name}) AS sim
    FROM players WHERE name % ${name}
    ORDER BY sim DESC LIMIT 1
  `;
  if (r.length && Number(r[0].sim) > 0.65) return r[0];

  // 3. Insert new player
  const ins = await sql<{ id: number; name: string }[]>`
    INSERT INTO players (name, fide_id, federation, title)
    VALUES (${name}, ${fideId ?? null}, ${federation ?? null}, ${title ?? null})
    RETURNING id, name
  `;
  return ins[0];
}

async function linkPlayers(
  sql: Sql,
  idA: number,
  idB: number,
  period: string,
  tcType: number
): Promise<void> {
  const [a, b] = idA < idB ? [idA, idB] : [idB, idA];
  const classicalInc = tcType === 1 ? 1 : 0;
  const rapidInc = tcType === 2 ? 1 : 0;
  const blitzInc = tcType === 3 ? 1 : 0;
  await sql`
    INSERT INTO opponents (player_a_id, player_b_id, game_count, first_game_date, last_game_date, classical_count, rapid_count, blitz_count)
    VALUES (${a}, ${b}, 1, ${period}, ${period}, ${classicalInc}, ${rapidInc}, ${blitzInc})
    ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET
      game_count      = GREATEST(opponents.game_count, 1),
      last_game_date  = GREATEST(opponents.last_game_date, EXCLUDED.last_game_date),
      classical_count = GREATEST(opponents.classical_count, EXCLUDED.classical_count),
      rapid_count     = GREATEST(opponents.rapid_count,     EXCLUDED.rapid_count),
      blitz_count     = GREATEST(opponents.blitz_count,     EXCLUDED.blitz_count)
  `;
}

/**
 * Scrape all rated opponents for a player from FIDE's calculation pages and
 * upsert them into the database.
 *
 * - Marks `fide_scraped_at` on success (or partial success after timeout).
 * - Does NOT mark `fide_scraped_at` on network errors, allowing a retry.
 * - Returns the number of opponents linked.
 */
export async function scrapeFidePlayer(
  fideId: number,
  sql: Sql
): Promise<{ opponentsLinked: number }> {
  console.log(`[fide-scraper] Scraping FIDE ID ${fideId}...`);

  // 1. Get profile info
  const info = await getPlayerInfo(fideId);
  if (!info.name) {
    console.warn(`[fide-scraper] Player ${fideId} not found on FIDE — marking scraped.`);
    await sql`UPDATE players SET fide_scraped_at = NOW() WHERE fide_id = ${fideId}`;
    return { opponentsLinked: 0 };
  }
  console.log(`[fide-scraper] ${info.name} (${info.federation ?? "?"} ${info.title ?? "—"})`);

  // 2. Get periods + session cookie
  const { periods, cookie } = await getPeriodsAndCookie(fideId);
  if (periods.length === 0) {
    console.log(`[fide-scraper] No rating periods found for ${fideId} — marking scraped.`);
    await sql`UPDATE players SET fide_scraped_at = NOW() WHERE fide_id = ${fideId}`;
    return { opponentsLinked: 0 };
  }
  console.log(`[fide-scraper] ${periods.length} periods, newest: ${periods[0]}`);

  // 3. Collect all unique opponents across periods × time controls
  const allOpponents = new Map<string, OpponentEntry>();
  for (const period of periods) {
    for (const t of [1, 2, 3] as const) {
      const html = await fetchCalc(fideId, period, t, cookie);
      const opps = parseOpponents(html, period);
      for (const o of opps) {
        const key = o.fide_id ? `fide:${o.fide_id}` : `name:${o.name.toLowerCase().trim()}`;
        if (!allOpponents.has(key)) {
          allOpponents.set(key, { ...o, tcTypes: new Set() });
        }
        allOpponents.get(key)!.tcTypes.add(t);
      }
    }
  }
  console.log(`[fide-scraper] ${allOpponents.size} unique opponents found`);

  // 4. Upsert main player
  const mainPlayer = await findOrInsertPlayer(sql, info.name, fideId, info.federation, info.title);

  // 5. Upsert opponents and edges
  let linked = 0;
  for (const [, opp] of allOpponents) {
    try {
      const dbOpp = await findOrInsertPlayer(sql, opp.name, opp.fide_id, opp.federation, opp.title);
      if (dbOpp.id === mainPlayer.id) continue;
      for (const tcType of opp.tcTypes) {
        await linkPlayers(sql, mainPlayer.id, dbOpp.id, opp.period, tcType);
      }
      linked++;
    } catch {
      // Skip individual failures — don't abort the whole scrape
    }
  }

  // 6. Mark scraped
  await sql`UPDATE players SET fide_scraped_at = NOW() WHERE fide_id = ${fideId}`;
  console.log(`[fide-scraper] Done: ${info.name} linked to ${linked} opponents.`);

  return { opponentsLinked: linked };
}
