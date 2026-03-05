"""
Verify that every World Chess Champion is in the DB and connected to the next
champion in the chain. Prints a status table and highlights any broken links.

Usage:
    DATABASE_URL=... python -m etl.verify_chain
"""
import os
import sys
import psycopg
from etl.db import get_db_url

# All undisputed/classical world champions in chronological order.
# (name as stored in DB, birth_year, death_year)
CHAMPIONS = [
    ("Morphy, Paul",               1837, 1884),
    ("Steinitz, William",          1836, 1900),
    ("Lasker, Emanuel",            1868, 1941),
    ("Capablanca, Jose Raul",      1888, 1942),
    ("Alekhine, Alexander",        1892, 1946),
    ("Euwe, Max",                  1901, 1981),
    ("Botvinnik, Mikhail",         1911, 1995),
    ("Smyslov, Vassily",           1921, 2010),
    ("Tal, Mihail",                1936, 1992),
    ("Petrosian, Tigran V",        1929, 1984),
    ("Spassky, Boris V",           1937, None),
    ("Fischer, Robert James",      1943, 2008),
    ("Karpov, Anatoly",            1951, None),
    ("Kasparov, Garry",            1963, None),   # also exists as "Kasparov, Gary" — dedup first
    ("Kramnik, Vladimir",          1975, None),
    ("Anand, Viswanathan",         1969, None),
    ("Carlsen, Magnus",            1990, None),
    ("Ding, Liren",                1992, None),   # also exists as "Ding, L"
]

GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
RESET  = "\033[0m"

def fmt(ok: bool | None, text: str) -> str:
    if ok is True:  return f"{GREEN}{text}{RESET}"
    if ok is None:  return f"{YELLOW}{text}{RESET}"
    return f"{RED}{text}{RESET}"


def main() -> None:
    url = get_db_url()
    conn = psycopg.connect(url)
    cur = conn.cursor()

    print(f"\n{'Champion':<30} {'In DB':>6} {'Birth':>6} {'Death':>6} {'Games':>7}")
    print("-" * 62)

    player_ids: dict[str, int | None] = {}

    for name, exp_birth, exp_death in CHAMPIONS:
        cur.execute(
            "SELECT id, birth_year, death_year FROM players WHERE name = %s LIMIT 1",
            (name,),
        )
        row = cur.fetchone()
        if row is None:
            print(f"{name:<30} {fmt(False,'MISSING'):>14}")
            player_ids[name] = None
            continue

        pid, birth, death = row
        player_ids[name] = pid

        birth_ok = birth == exp_birth
        death_ok = (death == exp_death) or (exp_death is None and death is None)

        cur.execute(
            """
            SELECT COALESCE(SUM(game_count), 0)
            FROM (
                SELECT game_count FROM opponents WHERE player_a_id = %s
                UNION ALL
                SELECT game_count FROM opponents WHERE player_b_id = %s
            ) t
            """,
            (pid, pid),
        )
        total_games = cur.fetchone()[0]

        in_db_str   = fmt(True, "  yes")
        birth_str   = fmt(birth_ok, str(birth) if birth else "  ---")
        death_str   = fmt(death_ok, str(death) if death else "  ---")
        games_str   = fmt(total_games > 0, f"{total_games:>7,}")

        print(f"{name:<30} {in_db_str:>14} {birth_str:>14} {death_str:>14} {games_str:>15}")

    print("\n" + "=" * 62)
    print("Consecutive champion connections:")
    print(f"{'Pair':<50} {'Games':>7}")
    print("-" * 62)

    names = [c[0] for c in CHAMPIONS]
    for i in range(len(names) - 1):
        a_name, b_name = names[i], names[i + 1]
        a_id = player_ids.get(a_name)
        b_id = player_ids.get(b_name)
        if a_id is None or b_id is None:
            label = f"{a_name} → {b_name}"
            print(f"{label:<50} {fmt(False, ' MISSING PLAYER'):>15}")
            continue

        cur.execute(
            """
            SELECT COALESCE(SUM(game_count), 0) FROM opponents
            WHERE (player_a_id = %s AND player_b_id = %s)
               OR (player_a_id = %s AND player_b_id = %s)
            """,
            (a_id, b_id, b_id, a_id),
        )
        games = cur.fetchone()[0]
        label = f"{a_name} → {b_name}"
        ok = games > 0
        games_str = fmt(ok, f"{games:>7,}")
        note = "" if ok else "  ← NO DIRECT GAMES"
        print(f"{label:<50} {games_str:>15}{note}")

    print()
    conn.close()


if __name__ == "__main__":
    main()
