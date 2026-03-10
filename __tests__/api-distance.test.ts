import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../app/api/distance/route";
import * as bfs from "../lib/bfs";

// stub the DB so route handler doesn't try to connect
vi.mock("../lib/db", () => ({
  getDb: vi.fn(() => {
    const f = vi.fn().mockResolvedValue([]);
    return f;
  }),
}));

/** Parse the SSE stream from a Response and return the first 'result' or 'error' event data. */
async function parseSseResult(res: Response): Promise<unknown> {
  const text = await res.text();
  for (const block of text.split("\n\n")) {
    let eventType = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) eventType = line.slice(7).trim();
      else if (line.startsWith("data: ")) data = line.slice(6);
    }
    if (eventType === "result" || eventType === "error") return JSON.parse(data);
  }
  return null;
}

describe("/api/distance handler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(bfs, "isCacheWarm").mockReturnValue(true);
  });

  it("calls BFS by default and streams result", async () => {
    const fakeResult = { distance: 1, path: [] };
    vi.spyOn(bfs, "findShortestPath").mockResolvedValue(fakeResult as any);
    const url = new URL("http://localhost/api/distance?from=10&to=20");
    const req = new NextRequest(url);
    const res = await GET(req);
    const data = await parseSseResult(res);
    expect(data).toEqual(fakeResult);
    expect(bfs.findShortestPath).toHaveBeenCalledWith(10, 20, "all", expect.any(Function));
  });

  it("calls BFS with classical filter and streams result", async () => {
    const fakeResult = { distance: 2, path: [] };
    vi.spyOn(bfs, "findShortestPath").mockResolvedValue(fakeResult as any);
    const url = new URL("http://localhost/api/distance?from=1&to=2&tc=classical");
    const req = new NextRequest(url);
    const res = await GET(req);
    const data = await parseSseResult(res);
    expect(data).toEqual(fakeResult);
    expect(bfs.findShortestPath).toHaveBeenCalledWith(1, 2, "classical", expect.any(Function));
  });
});
