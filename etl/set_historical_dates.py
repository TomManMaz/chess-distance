from __future__ import annotations
"""Set birth_year and death_year for historical chess players.

Data is hardcoded from well-known historical records. Names must match
exactly what's in the DB (verified list; use validate_data.py to check).

Safe to re-run — uses UPDATE WHERE LOWER(name) = LOWER(%s).

Usage:
    DATABASE_URL=... python etl/set_historical_dates.py
"""

import sys
from pathlib import Path

import psycopg.rows

sys.path.insert(0, str(Path(__file__).parent.parent))
from etl.db import get_conn

# [exact_name_in_db, birth_year, death_year | None]
HISTORICAL_PLAYERS: list[tuple[str, int, int | None]] = [
    # 19th century masters
    ("Morphy, Paul ",               1837, 1884),  # trailing space in DB
    ("Anderssen, Adolf",            1818, 1879),
    ("Bird, Henry Edward",          1830, 1908),
    ("Steinitz, William",           1836, 1900),
    ("Blackburne, Joseph Henry",    1841, 1924),
    ("Zukertort, Johannes Hermann", 1842, 1888),
    ("Chigorin, Mikhail",           1850, 1908),
    ("Gunsberg, Isidor",            1854, 1930),

    # Turn-of-century / early 20th century
    ("Pillsbury, Harry Nelson",     1872, 1906),
    ("Maroczy, Geza",               1870, 1951),
    ("Lasker, Emanuel",             1868, 1941),
    ("Tarrasch, Siegbert",          1862, 1934),
    ("Schlechter, Carl",            1874, 1918),
    ("Janowsky, Dawid Markelowicz", 1868, 1927),
    ("Marshall, Frank James",       1877, 1944),
    ("Burn, Amos",                  1848, 1925),
    ("Teichmann, Richard",          1868, 1925),
    ("Mieses, Jacques",             1865, 1954),
    ("Swiderski, Rudolf",           1878, 1909),
    ("Wolf, Heinrich",              1875, 1943),

    # Classic era (1920s–1940s)
    ("Capablanca, Jose Raul",       1888, 1942),
    ("Alekhine, Alexander",         1892, 1946),
    ("Nimzowitsch, Aaron ",         1886, 1935),  # trailing space in DB
    ("Rubinstein, Akiba",           1882, 1961),
    ("Bernstein, Ossip",            1882, 1962),
    ("Reti, Richard",               1889, 1929),
    ("Spielmann, Rudolf",           1883, 1942),
    ("Bogoljubow, Efim",            1889, 1952),
    ("Vidmar, Milan Sr",            1885, 1962),
    ("Tartakower, Saviely",         1887, 1956),
    ("Breyer, Gyula",               1893, 1921),

    # Transition era (1930s–1970s)
    ("Euwe, Max",                   1901, 1981),
    ("Flohr, Salo",                 1908, 1983),
    ("Botvinnik, Mikhail",          1911, 1995),
    ("Keres, Paul",                 1916, 1975),
    ("Reshevsky, Samuel Herman",    1911, 1992),
    ("Fine, Reuben",                1914, 1993),
    ("Najdorf, Miguel",             1910, 1997),
    ("Denker, Arnold S",            1914, 2005),
    ("Lilienthal, Andor",           1911, 2010),
    ("Bondarevsky, Igor",           1913, 1979),
    ("Smyslov, Vassily",            1921, 2010),
    ("Geller, Efim P",              1925, 1998),
    ("Tal, Mihail",                 1936, 1992),
    ("Petrosian, Tigran V",         1929, 1984),
    ("Bronstein, David I",          1924, 2006),
    ("Gligoric, Svetozar",          1923, 2012),
    ("Larsen, Bent",                1935, 2010),
    ("Fischer, Robert James",       1943, 2008),
    ("Ivkov, B",                    1929, 2011),

    # Post-war / Soviet era
    ("Korchnoi, V",                 1931, 2016),
    ("Polugaevsky, Lev",            1934, 1995),
    ("Portisch, L",                 1937, None),
    ("Andersson, Ulf",              1951, None),
    ("Timman, J",                   1951, None),
    ("Spassky, Boris V",            1937, None),

    # Modern world champions (frequently appear in paths)
    ("Karpov, Anatoly",             1951, None),
    ("Kasparov, G",                 1963, None),
    ("Polgar, Ju",                  1976, None),
    ("Anand, Viswanathan",          1969, None),
    ("Kramnik, Vladimir",           1975, None),
    ("Carlsen, Magnus",             1990, None),
    ("Leko, Peter",                 1979, None),
    ("Adams, Michael",              1971, None),
    ("Short, Nigel D",              1965, None),
    ("Nakamura, Hikaru",            1987, None),
    ("Aronian, Levon",              1982, None),
    ("Giri, Anish",                 1994, None),
    ("Caruana, F",                  1992, None),
    ("Nepomniachtchi, I",           1990, None),
    ("Ding, L",                     1992, None),
    ("Grischuk, A",                 1983, None),
    ("Mamedyarov, S",               1985, None),
    ("Radjabov, T",                 1987, None),
    ("Svidler, P",                  1976, None),
    ("Topalov, V",                  1975, None),
    ("Ivanchuk, V",                 1969, None),
    ("Gelfand, B",                  1968, None),
    ("Bareev, E",                   1966, None),
    ("Shirov, A",                   1972, None),
    ("Morozevich, A",               1977, None),
    ("Ponomariov, R",               1983, None),
]


def main() -> None:
    conn = get_conn()
    print(f"Setting birth/death years for {len(HISTORICAL_PLAYERS)} historical players...")
    updated = 0
    not_found = 0

    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        for name, birth_year, death_year in HISTORICAL_PLAYERS:
            cur.execute("""
                UPDATE players
                SET birth_year = %s, death_year = %s
                WHERE LOWER(name) = LOWER(%s)
                RETURNING id, name
            """, (birth_year, death_year, name))
            rows = cur.fetchall()
            if rows:
                updated += len(rows)
                for r in rows:
                    print(f"  ✓ {r['name']} (id={r['id']}) → {birth_year}–{death_year}")
            else:
                not_found += 1
                print(f"  ? Not found in DB: \"{name}\"")
    conn.commit()

    print(f"\nDone: {updated} rows updated, {not_found} names not found in DB")
    conn.close()


if __name__ == "__main__":
    main()
