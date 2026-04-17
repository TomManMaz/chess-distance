type Endpoint = "distance" | "search" | "stats" | "games";

// Default to the Fly.io FastAPI backend so the deployed site keeps working
// without any env var set. Override via NEXT_PUBLIC_API_BASE:
//   - set to another URL to point at a different backend
//   - set to "same-origin" (literal string) to fall back to the Next.js /api/* routes
const DEFAULT_API_BASE = "https://chess-distance-api.fly.dev";

export function apiUrl(endpoint: Endpoint, query: string = ""): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE;
  const qs = query ? `?${query}` : "";

  if (raw === "same-origin") return `/api/${endpoint}${qs}`;

  const base = (raw && raw.length > 0 ? raw : DEFAULT_API_BASE).replace(/\/$/, "");
  return `${base}/api/v2/${endpoint}${qs}`;
}
