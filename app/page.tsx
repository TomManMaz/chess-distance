"use client";

import { useState, useEffect } from "react";
import PlayerSearch from "@/components/PlayerSearch";
import DistanceResultComponent from "@/components/DistanceResult";
import Stats from "@/components/Stats";
import type { SearchResult, DistanceResult } from "@/lib/types";
import { nameToSlug } from "@/lib/slug";

export default function Home() {
  const [playerA, setPlayerA] = useState<SearchResult | null>(null);
  const [playerB, setPlayerB] = useState<SearchResult | null>(null);
  const [externalA, setExternalA] = useState<SearchResult | null | undefined>(undefined);
  const [externalB, setExternalB] = useState<SearchResult | null | undefined>(undefined);
  const [result, setResult] = useState<DistanceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [classicalOnly, setClassicalOnly] = useState(false);
  const [tcFiltered, setTcFiltered] = useState(false);

  async function calculateWith(a: SearchResult, b: SearchResult, useClassicalOnly?: boolean) {
    setLoading(true);
    setStatus("");
    setError(null);
    setResult(null);
    setTcFiltered(false);
    const tc = (useClassicalOnly ?? classicalOnly) ? "classical" : "all";
    try {
      const res = await fetch(`/api/distance?from=${a.id}&to=${b.id}&tc=${tc}`);
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by double newlines
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          let eventType = "message";
          let data = "";
          for (const line of part.split("\n")) {
            if (line.startsWith("event: ")) eventType = line.slice(7).trim();
            else if (line.startsWith("data: ")) data = line.slice(6);
          }
          if (eventType === "status") {
            setStatus(data);
          } else if (eventType === "result") {
            const parsed = JSON.parse(data);
            setResult(parsed);
            const slugA = nameToSlug(a.name);
            const slugB = nameToSlug(b.name);
            window.history.replaceState(null, "", `/${slugA}/${slugB}`);
          } else if (eventType === "error") {
            const errData = JSON.parse(data);
            setError(errData.error || "Failed to calculate distance");
            setTcFiltered(!!errData.tcFiltered);
          }
        }
      }
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
      setStatus("");
    }
  }

  async function calculate(useClassicalOnly?: boolean) {
    if (!playerA || !playerB) return;
    await calculateWith(playerA, playerB, useClassicalOnly);
  }

  async function tryExample() {
    setError(null);
    try {
      // Use FIDE IDs for reliability: Carlsen=1503014, King Daniel J=400068
      const [resA, resB] = await Promise.all([
        fetch("/api/search?q=1503014").then(r => r.json()),
        fetch("/api/search?q=400068").then(r => r.json()),
      ]);
      const carlsen: SearchResult | undefined = resA[0];
      const king: SearchResult | undefined = resB[0];
      if (!carlsen || !king) { setError("Example players not found."); return; }
      setPlayerA(carlsen);
      setPlayerB(king);
      setExternalA(carlsen);
      setExternalB(king);
      await calculateWith(carlsen, king);
    } catch {
      setError("An error occurred. Please try again.");
    }
  }

  // Auto-load example on first render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { tryExample(); }, []);

  function handleToggleClassical() {
    const next = !classicalOnly;
    setClassicalOnly(next);
    if (playerA && playerB) calculate(next);
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-12">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold text-[var(--board-dark)] mb-3">
          Opponent distance computation
        </h1>
      </div>

      <div className="mb-2 text-[var(--text-secondary)]">
        Find the path between two chess players:
      </div>

      <div className="space-y-2">
        <PlayerSearch placeholder="First player" onSelect={setPlayerA} externalPlayer={externalA} />
        <PlayerSearch placeholder="Second player" onSelect={setPlayerB} externalPlayer={externalB} />

        {/* Classical-only toggle + calculate button on same row */}
        <div className="flex items-center gap-3 pt-1">
          <button
            role="switch"
            aria-checked={classicalOnly}
            onClick={handleToggleClassical}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none cursor-pointer ${
              classicalOnly ? "bg-[var(--board-dark)]" : "bg-[var(--board-light)]"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                classicalOnly ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
          <span className="text-sm text-[var(--text-secondary)] grow">
            Classical games only
          </span>
          <button
            onClick={() => calculate()}
            disabled={!playerA || !playerB || loading}
            className="py-2 px-5 bg-[var(--board-dark)] text-white font-semibold
                       rounded-lg hover:bg-[var(--board-dark)]/90 disabled:opacity-50
                       disabled:cursor-not-allowed transition-all text-sm shrink-0"
          >
            {loading ? "Calculating…" : "Find path"}
          </button>
        </div>

        {/* Progress bar */}
        {loading && (
          <div className="mt-3">
            <div className="h-1 bg-[var(--board-light)] rounded-full overflow-hidden">
              <div
                className="h-full w-1/3 bg-[var(--accent)] rounded-full"
                style={{ animation: "loading-slide 1.4s ease-in-out infinite" }}
              />
            </div>
            <p className="mt-1.5 text-xs text-center text-[var(--text-secondary)]">
              {status || "Connecting…"}
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-6 p-4 bg-red-50 text-red-700 rounded-lg border border-red-200 text-center">
          {error}
          {tcFiltered && (
            <div className="mt-2">
              <button
                onClick={() => {
                  setClassicalOnly(false);
                  setTcFiltered(false);
                  if (playerA && playerB) calculateWith(playerA, playerB, false);
                }}
                className="text-sm underline cursor-pointer hover:text-red-900"
              >
                Try with all games
              </button>
            </div>
          )}
        </div>
      )}

      {result && <DistanceResultComponent result={result} />}

      {/* "What is that distance?" link */}
      <div className="text-center mt-8">
        <button
          onClick={() => setShowExplanation(!showExplanation)}
          className="text-[var(--accent)] hover:text-[var(--board-dark)] underline cursor-pointer transition-colors"
        >
          what is that distance?
        </button>
      </div>

      {showExplanation && (
        <div className="mt-4 p-6 bg-[var(--bg-card)] rounded-lg border border-[var(--board-light)] text-sm text-[var(--text-secondary)] leading-relaxed">
          <p className="mb-3">
            <em className="text-3xl float-left mr-3 leading-none text-[var(--board-dark)]">&ldquo;</em>
            Chess Distance finds the shortest opponent path between two chess
            players. An opponent path is a list of players where each
            neighboring pair has played at least one rated game against each
            other.
          </p>
          <p className="mb-3">
            When multiple shortest paths exist, the system selects the path
            where the sum of game counts between neighbors is highest &mdash;
            preferring connections through players who have faced each other
            many times.
          </p>
          <p className="mb-3">
            The <strong>Classical games only</strong> toggle restricts the
            graph to edges where at least one classical (long time-control)
            game was played, giving a stricter notion of opponent distance.
          </p>
          <p className="mb-3">
            If no opponent path exists between two players, the system reports
            an infinite distance (denoted &infin;). This is relatively rare
            since most active FIDE-rated players are in the same connected
            component of the graph.
          </p>
          <p className="italic">
            Data sources:{" "}
            <a
              href="https://lumbrasgigabase.com"
              className="underline hover:text-[var(--board-dark)]"
              target="_blank"
              rel="noopener noreferrer"
            >
              Lumbra&apos;s Gigabase
            </a>{" "}
            (OTB games) and{" "}
            <a
              href="https://theweekinchess.com/twic"
              className="underline hover:text-[var(--board-dark)]"
              target="_blank"
              rel="noopener noreferrer"
            >
              TWIC
            </a>{" "}
            (recent games).
          </p>
        </div>
      )}

      <Stats />
    </main>
  );
}
