import { NextRequest } from "next/server";
import { findShortestPath, isCacheWarm } from "@/lib/bfs";
import type { TimeControlFilter } from "@/lib/bfs";

const DISTANCE_TIMEOUT_MS = 25_000;

export async function GET(request: NextRequest) {
  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  const tcParam = request.nextUrl.searchParams.get("tc");

  if (!fromParam || !toParam) {
    return Response.json(
      { error: "Both 'from' and 'to' query parameters are required" },
      { status: 400 }
    );
  }

  const fromId = parseInt(fromParam, 10);
  const toId = parseInt(toParam, 10);

  if (isNaN(fromId) || isNaN(toId)) {
    return Response.json(
      { error: "'from' and 'to' must be valid player IDs" },
      { status: 400 }
    );
  }

  const tcFilter: TimeControlFilter =
    tcParam === "classical" ? "classical" : "all";

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: string) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${data}\n\n`)
        );
      }

      const TIMEOUT = Symbol("timeout");
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      try {
        // Tell the client whether this is a cold start or a warm cache hit
        send("status", isCacheWarm() ? "Searching for shortest path…" : "Loading game graph…");

        const bfsPromise = findShortestPath(fromId, toId, tcFilter, (msg) =>
          send("status", msg)
        );
        const timeoutPromise = new Promise<typeof TIMEOUT>((resolve) => {
          timeoutHandle = setTimeout(() => resolve(TIMEOUT), DISTANCE_TIMEOUT_MS);
        });

        const raced = await Promise.race([bfsPromise, timeoutPromise]);

        if (raced === TIMEOUT) {
          send("error", JSON.stringify({
            error: "The search took too long. Please try again.",
            code: "timeout",
          }));
        } else if (!raced) {
          const error =
            tcFilter === "classical"
              ? "No path found through classical games only. Try disabling the filter."
              : "No path found between these players";
          send("error", JSON.stringify({ error, tcFiltered: tcFilter === "classical" }));
        } else {
          send("result", JSON.stringify(raced));
        }
      } catch (err) {
        send("error", JSON.stringify({ error: "An error occurred. Please try again.", code: "internal" }));
        console.error("[distance]", err);
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no", // disable Nginx / Vercel proxy buffering
    },
  });
}
