import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "../app/api/distance/route";
import * as bfs from "../lib/bfs";

// stub the DB so route handler doesn't try to connect
vi.mock("../lib/db", () => ({
  getDb: vi.fn(() => {
    const f = vi.fn().mockResolvedValue([]);
    return f;
  }),
}));
// stub scraper so it doesn't hit external network
vi.mock("../lib/fide-scraper", () => ({
  scrapeFidePlayer: vi.fn().mockResolvedValue(undefined),
}));

describe("/api/distance handler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("calls BFS by default", async () => {
    const fakeResult = { distance: 1, path: [] };
    vi.spyOn(bfs, "findShortestPath").mockResolvedValue(fakeResult as any);
    const url = new URL("http://localhost/api/distance?from=10&to=20");
    const req = new NextRequest(url);
    const res = (await GET(req)) as NextResponse;
    const json = await res.json();
    expect(json).toEqual(fakeResult);
    expect(bfs.findShortestPath).toHaveBeenCalledWith(10, 20, "all");
  });

  it("calls BFS with classical filter", async () => {
    const fakeResult = { distance: 2, path: [] };
    vi.spyOn(bfs, "findShortestPath").mockResolvedValue(fakeResult as any);
    const url = new URL("http://localhost/api/distance?from=1&to=2&tc=classical");
    const req = new NextRequest(url);
    const res = (await GET(req)) as NextResponse;
    const json = await res.json();
    expect(json).toEqual(fakeResult);
    expect(bfs.findShortestPath).toHaveBeenCalledWith(1, 2, "classical");
  });
});
