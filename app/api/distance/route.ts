import { NextRequest, NextResponse } from "next/server";
import { findShortestPath } from "@/lib/bfs";

export async function GET(request: NextRequest) {
  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");

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

  const result = await findShortestPath(fromId, toId);

  if (!result) {
    return NextResponse.json(
      { error: "No path found between these players" },
      { status: 404 }
    );
  }

  return NextResponse.json(result);
}
