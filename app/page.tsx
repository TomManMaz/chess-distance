"use client";

import { useState, useEffect } from "react";
import PlayerSearch from "@/components/PlayerSearch";
import DistanceResultComponent from "@/components/DistanceResult";
import Stats from "@/components/Stats";
import type { SearchResult, DistanceResult } from "@/lib/types";

export default function Home() {
  const [playerA, setPlayerA] = useState<SearchResult | null>(null);
  const [playerB, setPlayerB] = useState<SearchResult | null>(null);
  const [externalA, setExternalA] = useState<SearchResult | null | undefined>(undefined);
  const [externalB, setExternalB] = useState<SearchResult | null | undefined>(undefined);
  const [result, setResult] = useState<DistanceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [classicalOnly, setClassicalOnly] = useState(false);
  const [tcFiltered, setTcFiltered] = useState(false);

  async function calculateWith(a: SearchResult, b: SearchResult, useClassicalOnly?: boolean) {
    setLoading(true);
    setError(null);
    setResult(null);
    setTcFiltered(false);
    const tc = (useClassicalOnly ?? classicalOnly) ? "classical" : "all";
    try {
      const res = await fetch(`/api/distance?from=${a.id}&to=${b.id}&tc=${tc}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to calculate distance");
        setTcFiltered(!!data.tcFiltered);
        return;
      }
      setResult(await res.json());
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function calculate(useClassicalOnly?: boolean) {
    if (!playerA || !playerB) return;
    await calculateWith(playerA, playerB, useClassicalOnly);
  }

  async function tryExample() {
    setError(null);
    try {
      const [resA, resB] = await Promise.all([
        fetch("/api/search?q=Carlsen").then(r => r.json()),
        fetch("/api/search?q=Morphy").then(r => r.json()),
      ]);
      const carlsen: SearchResult | undefined =
        resA.find((p: SearchResult) => p.name === "Carlsen, Magnus") ||
        resA.find((p: SearchResult) => /carlsen.*magnus|magnus.*carlsen/i.test(p.name)) ||
        resA.find((p: SearchResult) => p.name.toLowerCase().includes("carlsen"));
      const morphy: SearchResult | undefined =
        resB.find((p: SearchResult) => /morphy.*paul|paul.*morphy/i.test(p.name)) ||
        resB.find((p: SearchResult) => p.name.toLowerCase().includes("morphy"));
      if (!carlsen || !morphy) { setError("Example players not found."); return; }
      setPlayerA(carlsen);
      setPlayerB(morphy);
      setExternalA(carlsen);
      setExternalB(morphy);
      await calculateWith(carlsen, morphy);
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
              classicalOnly ? "bg-[var(--board-dark)]" : "bg-gray-300"
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
        <div className="mt-4 p-6 bg-white rounded-lg border border-gray-200 text-sm text-[var(--text-secondary)] leading-relaxed">
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
            Data source: games are sourced from the{" "}
            <a
              href="https://theweekinchess.com/twic"
              className="underline hover:text-[var(--board-dark)]"
              target="_blank"
              rel="noopener noreferrer"
            >
              TWIC (The Week in Chess)
            </a>{" "}
            archive of FIDE-rated games.
          </p>
        </div>
      )}

      <Stats />

      <footer className="mt-16 text-center text-sm text-[var(--text-secondary)]">
        Inspired by{" "}
        <a
          href="https://csauthors.net/distance"
          className="underline hover:text-[var(--board-dark)]"
          target="_blank"
          rel="noopener noreferrer"
        >
          CSauthors.net/distance
        </a>
        .{" "}
        <a
          href="https://github.com/TomManMaz/chess-distance"
          className="underline hover:text-[var(--board-dark)]"
          target="_blank"
          rel="noopener noreferrer"
        >
          Source on GitHub
        </a>
        .
        <br />
        <span className="text-xs">
          Built with{" "}
          <a href="https://nextjs.org" className="underline hover:text-[var(--board-dark)]" target="_blank" rel="noopener noreferrer">Next.js</a>,{" "}
          <a href="https://neon.tech" className="underline hover:text-[var(--board-dark)]" target="_blank" rel="noopener noreferrer">Neon PostgreSQL</a>,{" "}
          <a href="https://tailwindcss.com" className="underline hover:text-[var(--board-dark)]" target="_blank" rel="noopener noreferrer">Tailwind CSS</a>,{" "}
          and <a href="https://vercel.com" className="underline hover:text-[var(--board-dark)]" target="_blank" rel="noopener noreferrer">Vercel</a>.
        </span>
      </footer>
    </main>
  );
}
