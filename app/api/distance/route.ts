import { NextRequest, NextResponse } from "next/server";
import { findShortestPath } from "@/lib/bfs";
import type { TimeControlFilter } from "@/lib/bfs";

export async function GET(request: NextRequest) {
  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  const tcParam = request.nextUrl.searchParams.get("tc");

  if (!fromParam || !toParam) {
    return NextResponse.json(
      { error: "Both 'from' and 'to' query parameters are required" },
      { status: 400 }
    );
  }

  const fromId = parseInt(fromParam, 10);
  const toId = parseInt(toParam, 10);

  if (isNaN(fromId) || isNaN(toId)) {
    return NextResponse.json(
      { error: "'from' and 'to' must be valid player IDs" },
      { status: 400 }
    );
  }

  const tcFilter: TimeControlFilter =
    tcParam === "classical" ? "classical" : "all";

  const result = await findShortestPath(fromId, toId, tcFilter);

  if (!result) {
    const error =
      tcFilter === "classical"
        ? "No path found through classical games only. Try disabling the filter."
        : "No path found between these players";
    return NextResponse.json({ error, tcFiltered: tcFilter === "classical" }, { status: 404 });
  }

  return NextResponse.json(result);
}
