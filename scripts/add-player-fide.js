#!/usr/bin/env node
/**
 * Add a player and their rated opponents to the DB by scraping FIDE.
 * Usage: node scripts/add-player-fide.js <fide_id>
 *
 * Fetches all available rating periods from the player's FIDE calculations
 * page, then pulls opponent lists for Standard, Rapid, and Blitz.
 */

const { neon } = require("@neondatabase/serverless");
const https = require("https");

const FIDE_ID = parseInt(process.argv[2]);
if (!FIDE_ID) {
  console.error("Usage: node scripts/add-player-fide.js <fide_id>");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const BASE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

function get(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get(
      { hostname: u.hostname, path: u.pathname + u.search,
        headers: { ...BASE_HEADERS, ...extraHeaders } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ body, status: res.statusCode, headers: res.headers }));
      }
    ).on("error", reject)
     .setTimeout(12000, function() { this.destroy(new Error("timeout")); });
  });
}

// Extract all available periods from the JS arrays in the calculations page
function extractPeriods(html) {
  const periods = new Set();
  const matches = html.matchAll(/(?:std|rapid|blitz)_array\s*=\s*\[([^\]]+)\]/g);
  for (const m of matches) {
    for (const d of m[1].matchAll(/"(\d{4}-\d{2}-\d{2})"/g)) {
      periods.add(d[1]);
    }
  }
  return [...periods].sort().reverse(); // newest first
}

// Parse opponent rows from FIDE calculation HTML
function parseOpponents(html, period) {
  if (!html || html.includes("No records found")) return [];

  const opponents = [];
  // Each opponent row has a link: href="...id_number=XXXXX..."
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const row = m[1];
    if (!row.includes("id_number=")) continue;

    const fideMatch = row.match(/id_number=(\d+)/);
    const fideId = fideMatch ? parseInt(fideMatch[1]) : null;

    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(c => c[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").trim())
      .filter(Boolean);

    if (cells.length < 2) continue;
    const name = cells[0];
    if (!name || name.length < 2 || /^\d+$/.test(name)) continue;

    const fed = cells.find(c => /^[A-Z]{3}$/.test(c) && !["ELO","IMP","GMS","RES"].includes(c));
    const title = cells.find(c => /^W?(GM|IM|FM|CM|NM)$/.test(c));

    opponents.push({ name, fide_id: fideId, federation: fed || null, title: title || null, period });
  }
  return opponents;
}

async function getPlayerInfo(fideId) {
  const { body } = await get(`https://ratings.fide.com/profile/${fideId}`);
  // Name from <title>Lastname, Firstname FIDE Profile</title> or <h1>
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

async function getPeriodsAndCookie(fideId) {
  const { body, headers } = await get(
    `https://ratings.fide.com/calculations.phtml?id_number=${fideId}`,
    { Referer: "https://ratings.fide.com/" }
  );
  const cookie = (headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");
  const periods = extractPeriods(body);
  return { periods, cookie };
}

async function fetchCalc(fideId, period, t, cookie) {
  // Correct endpoint: rating_period + t (not period + rating)
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

async function findOrInsertPlayer(name, fideId, federation, title) {
  // 1. Match by FIDE ID
  if (fideId) {
    const r = await sql`SELECT id, name FROM players WHERE fide_id = ${fideId}`;
    if (r.length) return r[0];
  }
  // 2. Fuzzy name match
  const r = await sql`
    SELECT id, name, similarity(name, ${name}) AS sim
    FROM players WHERE name % ${name}
    ORDER BY sim DESC LIMIT 1
  `;
  if (r.length && Number(r[0].sim) > 0.65) return r[0];

  // 3. Insert new player
  const ins = await sql`
    INSERT INTO players (name, fide_id, federation, title)
    VALUES (${name}, ${fideId || null}, ${federation || null}, ${title || null})
    RETURNING id, name
  `;
  return ins[0];
}

async function linkPlayers(idA, idB, period) {
  const [a, b] = idA < idB ? [idA, idB] : [idB, idA];
  await sql`
    INSERT INTO opponents (player_a_id, player_b_id, game_count, first_game_date, last_game_date)
    VALUES (${a}, ${b}, 1, ${period}, ${period})
    ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET
      game_count        = GREATEST(opponents.game_count, 1),
      last_game_date    = GREATEST(opponents.last_game_date, EXCLUDED.last_game_date)
  `;
}

async function main() {
  // 1. Get player profile
  console.log(`\nFetching FIDE profile ${FIDE_ID}...`);
  const info = await getPlayerInfo(FIDE_ID);
  if (!info.name) { console.error("Player not found on FIDE."); process.exit(1); }
  console.log(`  Name: ${info.name}  Fed: ${info.federation}  Title: ${info.title || "—"}`);

  // 2. Get available periods + session cookie
  console.log("Fetching available rating periods...");
  const { periods, cookie } = await getPeriodsAndCookie(FIDE_ID);
  if (periods.length === 0) {
    console.log("  No periods found — player may have no rated games.");
    process.exit(0);
  }
  console.log(`  ${periods.length} periods: ${periods.slice(0,5).join(", ")}...`);

  // 3. Fetch all periods × rating types
  const allOpponents = new Map(); // key → opponent data
  let checked = 0;
  const total = periods.length * 3;

  for (const period of periods) {
    for (const t of [1, 2, 3]) { // 1=Standard, 2=Rapid, 3=Blitz
      const html = await fetchCalc(FIDE_ID, period, t, cookie);
      const opps = parseOpponents(html, period);
      for (const o of opps) {
        const key = o.fide_id ? `fide:${o.fide_id}` : `name:${o.name.toLowerCase().trim()}`;
        if (!allOpponents.has(key)) allOpponents.set(key, o);
      }
      checked++;
      const label = ["Std","Rpd","Blz"][t - 1];
      process.stdout.write(
        `\r  [${checked}/${total}] ${period} ${label} → ${opps.length} opps found (unique total: ${allOpponents.size})   `
      );
    }
  }
  console.log("\n");

  if (allOpponents.size === 0) {
    console.log("⚠  No opponents retrieved. The FIDE calculation endpoint may require");
    console.log("   a live browser session. Try visiting the page manually and pasting");
    console.log("   opponent data, or check the player's FIDE ID.");
    process.exit(0);
  }

  // 4. Upsert main player
  const mainPlayer = await findOrInsertPlayer(info.name, FIDE_ID, info.federation, info.title);
  console.log(`Main player in DB → id=${mainPlayer.id}  "${mainPlayer.name}"`);

  // 5. Insert opponents and links
  let linked = 0, skipped = 0;
  for (const [, opp] of allOpponents) {
    try {
      const dbOpp = await findOrInsertPlayer(opp.name, opp.fide_id, opp.federation, opp.title);
      if (dbOpp.id === mainPlayer.id) continue;
      await linkPlayers(mainPlayer.id, dbOpp.id, opp.period);
      linked++;
      process.stdout.write(`\r  Linked ${linked}/${allOpponents.size}: ${dbOpp.name.slice(0, 40)}   `);
    } catch (e) {
      skipped++;
    }
  }

  console.log(`\n\n✓ Done! "${info.name}" linked to ${linked} opponents (${skipped} skipped).`);
  console.log(`  Search for them on https://chess-distance.vercel.app`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
