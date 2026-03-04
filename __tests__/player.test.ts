import { describe, it, expect, vi } from "vitest";
import { getPlayerData, getPlayerBySlug, getTopNeighbors } from "../lib/player";
import { getDb } from "../lib/db";

vi.mock("../lib/db", () => {
  return {
    getDb: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// getPlayerData
// ---------------------------------------------------------------------------
describe("getPlayerData", () => {
  it("returns null when no record", async () => {
    const fakeSql = vi.fn().mockResolvedValue([]);
    (getDb as unknown as vi.Mock).mockReturnValue(fakeSql);
    const res = await getPlayerData(123);
    expect(res).toBeNull();
    expect(fakeSql).toHaveBeenCalled();
  });

  it("returns first row when found", async () => {
    const row = {
      id: 5,
      name: "Foo",
      fide_id: null,
      federation: null,
      title: null,
      birth_year: null,
      death_year: null,
      total_games: 10,
    };
    const fakeSql = vi.fn().mockResolvedValue([row]);
    (getDb as unknown as vi.Mock).mockReturnValue(fakeSql);
    const res = await getPlayerData(5);
    expect(res).toEqual(row);
  });
});

// ---------------------------------------------------------------------------
// getPlayerBySlug
// ---------------------------------------------------------------------------
describe("getPlayerBySlug", () => {
  it("returns null when no player has that slug", async () => {
    const fakeSql = vi.fn().mockResolvedValue([]);
    (getDb as unknown as vi.Mock).mockReturnValue(fakeSql);
    const res = await getPlayerBySlug("nobody-unknown");
    expect(res).toBeNull();
  });

  it("returns the player row when slug matches", async () => {
    const row = {
      id: 1503014,
      name: "Carlsen, Magnus",
      fide_id: 1503014,
      federation: "NOR",
      title: "GM",
      birth_year: 1990,
      death_year: null,
      total_games: 2500,
    };
    const fakeSql = vi.fn().mockResolvedValue([row]);
    (getDb as unknown as vi.Mock).mockReturnValue(fakeSql);
    const res = await getPlayerBySlug("magnus-carlsen");
    expect(res).toEqual(row);
    expect(res?.name).toBe("Carlsen, Magnus");
    expect(res?.fide_id).toBe(1503014);
    expect(res?.title).toBe("GM");
    expect(res?.birth_year).toBe(1990);
    expect(res?.federation).toBe("NOR");
  });

  it("simulates Magnus Carlsen player profile fields", async () => {
    // Mirrors real data expected for FIDE ID 1503014
    const row = {
      id: 1503014,
      name: "Carlsen, Magnus",
      fide_id: 1503014,
      federation: "NOR",
      title: "GM",
      birth_year: 1990,
      death_year: null,
      total_games: 2847,
    };
    const fakeSql = vi.fn().mockResolvedValue([row]);
    (getDb as unknown as vi.Mock).mockReturnValue(fakeSql);
    const res = await getPlayerBySlug("magnus-carlsen");
    expect(res).not.toBeNull();
    expect(res!.fide_id).toBe(1503014);
    expect(res!.birth_year).toBe(1990);
    expect(res!.federation).toBe("NOR");
    expect(res!.title).toBe("GM");
    expect(res!.total_games).toBeGreaterThan(0);
  });

  it("simulates Garry Kasparov player profile fields", async () => {
    // Kasparov FIDE ID: 4100018, born 1963, RUS/AZE
    const row = {
      id: 4100018,
      name: "Kasparov, Garry",
      fide_id: 4100018,
      federation: "RUS",
      title: "GM",
      birth_year: 1963,
      death_year: null,
      total_games: 1540,
    };
    const fakeSql = vi.fn().mockResolvedValue([row]);
    (getDb as unknown as vi.Mock).mockReturnValue(fakeSql);
    const res = await getPlayerBySlug("garry-kasparov");
    expect(res).not.toBeNull();
    expect(res!.fide_id).toBe(4100018);
    expect(res!.birth_year).toBe(1963);
    expect(res!.title).toBe("GM");
    expect(res!.federation).toBe("RUS");
  });

  it("returns only the first row if somehow multiple match", async () => {
    const rows = [
      { id: 1, name: "Smith, John", fide_id: 111, federation: "ENG", title: null, birth_year: null, death_year: null, total_games: 100 },
      { id: 2, name: "Smith, John", fide_id: 222, federation: "ENG", title: null, birth_year: null, death_year: null, total_games: 50 },
    ];
    const fakeSql = vi.fn().mockResolvedValue(rows);
    (getDb as unknown as vi.Mock).mockReturnValue(fakeSql);
    const res = await getPlayerBySlug("john-smith");
    expect(res).toEqual(rows[0]);
  });
});

// ---------------------------------------------------------------------------
// getTopNeighbors
// ---------------------------------------------------------------------------
describe("getTopNeighbors", () => {
  it("returns empty array when player has no opponents", async () => {
    const fakeSql = vi.fn().mockResolvedValue([]);
    (getDb as unknown as vi.Mock).mockReturnValue(fakeSql);
    const res = await getTopNeighbors(99999);
    expect(res).toEqual([]);
  });

  it("returns top opponents sorted by game_count desc", async () => {
    const rows = [
      { id: 2, name: "Anand, Viswanathan", title: "GM", federation: "IND", game_count: 200, slug: "viswanathan-anand" },
      { id: 3, name: "Caruana, Fabiano", title: "GM", federation: "USA", game_count: 150, slug: "fabiano-caruana" },
      { id: 4, name: "Giri, Anish", title: "GM", federation: "NED", game_count: 120, slug: "anish-giri" },
    ];
    const fakeSql = vi.fn().mockResolvedValue(rows);
    (getDb as unknown as vi.Mock).mockReturnValue(fakeSql);
    const res = await getTopNeighbors(1503014);
    expect(res).toHaveLength(3);
    expect(res[0].name).toBe("Anand, Viswanathan");
    expect(res[0].game_count).toBe(200);
    expect(res[1].name).toBe("Caruana, Fabiano");
    expect(res[2].name).toBe("Giri, Anish");
  });

  it("simulates Magnus Carlsen top-5 opponents structure", async () => {
    // Top opponents are well-known GMs Carlsen regularly faces
    const rows = [
      { id: 2, name: "Anand, Viswanathan", title: "GM", federation: "IND", game_count: 220, slug: "viswanathan-anand" },
      { id: 3, name: "Caruana, Fabiano", title: "GM", federation: "USA", game_count: 195, slug: "fabiano-caruana" },
      { id: 4, name: "Nakamura, Hikaru", title: "GM", federation: "USA", game_count: 180, slug: "hikaru-nakamura" },
      { id: 5, name: "Aronian, Levon", title: "GM", federation: "ARM", game_count: 165, slug: "levon-aronian" },
      { id: 6, name: "Giri, Anish", title: "GM", federation: "NED", game_count: 140, slug: "anish-giri" },
    ];
    const fakeSql = vi.fn().mockResolvedValue(rows);
    (getDb as unknown as vi.Mock).mockReturnValue(fakeSql);
    const res = await getTopNeighbors(1503014, 5);
    expect(res).toHaveLength(5);
    // All should have titles
    for (const nb of res) {
      expect(nb.title).toBe("GM");
      expect(nb.game_count).toBeGreaterThan(0);
      expect(nb.slug).not.toBeNull();
    }
    // Sorted descending by game_count
    for (let i = 1; i < res.length; i++) {
      expect(res[i - 1].game_count).toBeGreaterThanOrEqual(res[i].game_count);
    }
  });

  it("simulates Garry Kasparov top-5 opponents structure", async () => {
    const rows = [
      { id: 10, name: "Karpov, Anatoly", title: "GM", federation: "RUS", game_count: 350, slug: "anatoly-karpov" },
      { id: 11, name: "Anand, Viswanathan", title: "GM", federation: "IND", game_count: 120, slug: "viswanathan-anand" },
      { id: 12, name: "Ivanchuk, Vassily", title: "GM", federation: "UKR", game_count: 110, slug: "vassily-ivanchuk" },
      { id: 13, name: "Kramnik, Vladimir", title: "GM", federation: "RUS", game_count: 100, slug: "vladimir-kramnik" },
      { id: 14, name: "Short, Nigel D", title: "GM", federation: "ENG", game_count: 90, slug: "nigel-d-short" },
    ];
    const fakeSql = vi.fn().mockResolvedValue(rows);
    (getDb as unknown as vi.Mock).mockReturnValue(fakeSql);
    const res = await getTopNeighbors(4100018, 5);
    expect(res).toHaveLength(5);
    expect(res[0].name).toBe("Karpov, Anatoly");
    expect(res[0].game_count).toBe(350);
    // All have slug set
    for (const nb of res) {
      expect(nb.slug).not.toBeNull();
    }
  });

  it("respects the limit parameter", async () => {
    const rows = [
      { id: 1, name: "A, B", title: null, federation: null, game_count: 10, slug: "b-a" },
      { id: 2, name: "C, D", title: null, federation: null, game_count: 8, slug: "d-c" },
    ];
    const fakeSql = vi.fn().mockResolvedValue(rows);
    (getDb as unknown as vi.Mock).mockReturnValue(fakeSql);
    const res = await getTopNeighbors(1, 2);
    expect(res).toHaveLength(2);
  });

  it("handles neighbor without slug (uses null)", async () => {
    const rows = [
      { id: 7, name: "OldPlayer", title: null, federation: null, game_count: 5, slug: null },
    ];
    const fakeSql = vi.fn().mockResolvedValue(rows);
    (getDb as unknown as vi.Mock).mockReturnValue(fakeSql);
    const res = await getTopNeighbors(999);
    expect(res[0].slug).toBeNull();
    expect(res[0].name).toBe("OldPlayer");
  });
});
