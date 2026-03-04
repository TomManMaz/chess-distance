import { describe, it, expect, vi } from "vitest";
import { getPlayerData } from "../lib/player";
import { getDb } from "../lib/db";

vi.mock("../lib/db", () => {
  return {
    getDb: vi.fn(),
  };
});

describe("getPlayerData", () => {
  it("returns null when no record", async () => {
    const fakeSql = vi.fn().mockResolvedValue([]);
    (getDb as unknown as vi.Mock).mockReturnValue(fakeSql);
    const res = await getPlayerData(123);
    expect(res).toBeNull();
    expect(fakeSql).toHaveBeenCalled();
  });

  it("returns first row when found", async () => {
    const row = { id: 5, name: "Foo", fide_id: null, federation: null, birth_year: null, death_year: null, total_games: 10 };
    const fakeSql = vi.fn().mockResolvedValue([row]);
    (getDb as unknown as vi.Mock).mockReturnValue(fakeSql);
    const res = await getPlayerData(5);
    expect(res).toEqual(row);
  });
});
