/**
 * set-historical-dates.js
 *
 * Sets birth_year and death_year for historical chess players who appear in
 * the database from PGN Mentor files. This data is hardcoded from well-known
 * historical records.
 *
 * Run this once after migrate-add-birth-death-years.js.
 * Safe to re-run (uses UPDATE ... WHERE name ILIKE).
 *
 * Usage:
 *   DATABASE_URL=... node scripts/set-historical-dates.js
 */

const { neon } = require("@neondatabase/serverless");

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("No DATABASE_URL"); process.exit(1); }
const sql = neon(DB_URL);

// Historical players: [exact_name_in_db, birth_year, death_year]
// Names verified against actual DB contents (run _find-missing scripts to check).
const HISTORICAL_PLAYERS = [
  // 19th century masters
  ["Morphy, Paul ",             1837, 1884],  // trailing space in DB
  ["Anderssen, Adolf",          1818, 1879],
  ["Bird, Henry Edward",        1830, 1908],
  ["Steinitz, William",         1836, 1900],  // "William" in DB, not "Wilhelm"
  ["Blackburne, Joseph Henry",  1841, 1924],
  ["Zukertort, Johannes Hermann", 1842, 1888],
  ["Chigorin, Mikhail",         1850, 1908],
  ["Gunsberg, Isidor",          1854, 1930],

  // Turn-of-century / early 20th century
  ["Pillsbury, Harry Nelson",   1872, 1906],
  ["Maroczy, Geza",             1870, 1951],
  ["Lasker, Emanuel",           1868, 1941],
  ["Tarrasch, Siegbert",        1862, 1934],
  ["Schlechter, Carl",          1874, 1918],
  ["Janowsky, Dawid Markelowicz", 1868, 1927],
  ["Marshall, Frank James",     1877, 1944],
  ["Burn, Amos",                1848, 1925],
  ["Teichmann, Richard",        1868, 1925],
  ["Mieses, Jacques",           1865, 1954],
  ["Swiderski, Rudolf",         1878, 1909],
  ["Wolf, Heinrich",            1875, 1943],

  // Classic era (1920s-1940s)
  ["Capablanca, Jose Raul",     1888, 1942],
  ["Alekhine, Alexander",       1892, 1946],
  ["Nimzowitsch, Aaron ",       1886, 1935],  // trailing space in DB
  ["Rubinstein, Akiba",         1882, 1961],
  ["Bernstein, Ossip",          1882, 1962],
  ["Reti, Richard",             1889, 1929],
  ["Spielmann, Rudolf",         1883, 1942],
  ["Bogoljubow, Efim",          1889, 1952],  // "Bogoljubow" in DB
  ["Vidmar, Milan Sr",          1885, 1962],
  ["Tartakower, Saviely",       1887, 1956],  // "Saviely" in DB (one 'l')
  ["Breyer, Gyula",             1893, 1921],

  // Transition era (1930s-1970s)
  ["Euwe, Max",                 1901, 1981],
  ["Flohr, Salo",               1908, 1983],
  ["Botvinnik, Mikhail",        1911, 1995],
  ["Keres, Paul",               1916, 1975],
  ["Reshevsky, Samuel Herman",  1911, 1992],
  ["Fine, Reuben",              1914, 1993],
  ["Najdorf, Miguel",           1910, 1997],
  ["Denker, Arnold S",          1914, 2005],
  ["Lilienthal, Andor",         1911, 2010],
  ["Bondarevsky, Igor",         1913, 1979],
  ["Smyslov, Vassily",          1921, 2010],
  ["Geller, Efim P",            1925, 1998],
  ["Tal, Mihail",               1936, 1992],  // "Mihail" in DB
  ["Petrosian, Tigran V",       1929, 1984],  // "Tigran V" in DB
  ["Bronstein, David I",        1924, 2006],
  ["Gligoric, Svetozar",        1923, 2012],
  ["Larsen, Bent",              1935, 2010],
  ["Fischer, Robert James",     1943, 2008],
  ["Ivkov, B",                  1929, 2011],  // only abbreviated name in DB

  // Post-war / Soviet era (commonly appear in paths to modern players)
  ["Korchnoi, V",               1931, 2016],
  ["Polugaevsky, Lev",          1934, 1995],
  ["Portisch, L",               1937, null],
  ["Andersson, Ulf",            1951, null],
  ["Timman, J",                 1951, null],  // Jan Timman
  ["Spassky, Boris V",          1937, null],

  // Modern world champions and top players (frequently in paths)
  ["Karpov, Anatoly",           1951, null],
  ["Kasparov, G",               1963, null],  // Garry Kasparov (abbreviated in DB)
  ["Polgar, Ju",                1976, null],  // Judit Polgar
  ["Anand, Viswanathan",        1969, null],
  ["Kramnik, Vladimir",         1975, null],
  ["Carlsen, Magnus",           1990, null],
  ["Leko, Peter",               1979, null],
  ["Adams, Michael",            1971, null],
  ["Short, Nigel D",            1965, null],
  ["Nakamura, Hikaru",          1987, null],
  ["Aronian, Levon",            1982, null],
  ["Giri, Anish",               1994, null],
  ["Caruana, F",                1992, null],
  ["Nepomniachtchi, I",         1990, null],
  ["Ding, L",                   1992, null],
  ["Grischuk, A",               1983, null],
  ["Mamedyarov, S",             1985, null],
  ["Radjabov, T",               1987, null],
  ["Svidler, P",                1976, null],
  ["Topalov, V",                1975, null],
  ["Ivanchuk, V",               1969, null],
  ["Gelfand, B",                1968, null],
  ["Bareev, E",                 1966, null],
  ["Shirov, A",                 1972, null],
  ["Morozevich, A",             1977, null],
  ["Ponomariov, R",             1983, null],
];

async function main() {
  console.log(`Setting birth/death years for ${HISTORICAL_PLAYERS.length} historical players...`);
  let updated = 0;
  let notFound = 0;

  for (const [name, birthYear, deathYear] of HISTORICAL_PLAYERS) {
    const rows = await sql`
      UPDATE players
      SET birth_year = ${birthYear}, death_year = ${deathYear}
      WHERE LOWER(name) = LOWER(${name})
      RETURNING id, name
    `;
    if (rows.length > 0) {
      updated += rows.length;
      for (const r of rows) {
        console.log(`  ✓ ${r.name} (id=${r.id}) → ${birthYear}–${deathYear}`);
      }
    } else {
      notFound++;
      console.log(`  ? Not found in DB: "${name}"`);
    }
  }

  console.log(`\nDone: ${updated} rows updated, ${notFound} names not found in DB`);
}

main().catch(console.error);
