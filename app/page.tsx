"use client";

import { useState } from "react";
import PlayerSearch from "@/components/PlayerSearch";
import DistanceResultComponent from "@/components/DistanceResult";
import Stats from "@/components/Stats";
import type { SearchResult, DistanceResult } from "@/lib/types";

export default function Home() {
  const [playerA, setPlayerA] = useState<SearchResult | null>(null);
  const [playerB, setPlayerB] = useState<SearchResult | null>(null);
  const [result, setResult] = useState<DistanceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);

  async function calculate() {
    if (!playerA || !playerB) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(
        `/api/distance?from=${playerA.id}&to=${playerB.id}`
      );
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to calculate distance");
        return;
      }
      const data: DistanceResult = await res.json();
      setResult(data);
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-12">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold text-[var(--board-dark)] mb-3">
          Opponent distance computation
        </h1>
      </div>

      <div className="text-center mb-6 text-[var(--text-secondary)]">
        Find the path between two chess players:
      </div>

      <div className="space-y-4">
        <PlayerSearch label="Player A" onSelect={setPlayerA} />
        <PlayerSearch label="Player B" onSelect={setPlayerB} />

        <button
          onClick={calculate}
          disabled={!playerA || !playerB || loading}
          className="w-full py-3 px-6 bg-[var(--board-dark)] text-white font-semibold
                     rounded-lg hover:bg-[var(--board-dark)]/90 disabled:opacity-50
                     disabled:cursor-not-allowed transition-all text-lg"
        >
          {loading ? "Calculating..." : "Calculate Distance"}
        </button>
      </div>

      {error && (
        <div className="mt-6 p-4 bg-red-50 text-red-700 rounded-lg border border-red-200 text-center">
          {error}
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
