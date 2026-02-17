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
          Chess Distance Calculator
        </h1>
        <p className="text-[var(--text-secondary)] max-w-md mx-auto">
          Find the shortest opponent path between any two chess players.
          Distance 1 = direct opponents, distance 2 = one player apart, and so
          on. Based on FIDE-rated games from the TWIC archive.
        </p>
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

      <Stats />

      <footer className="mt-16 text-center text-sm text-[var(--text-secondary)]">
        Data sourced from{" "}
        <a
          href="https://theweekinchess.com/twic"
          className="underline hover:text-[var(--board-dark)]"
          target="_blank"
          rel="noopener noreferrer"
        >
          The Week in Chess
        </a>{" "}
        archive. Inspired by{" "}
        <a
          href="https://csauthors.net/distance"
          className="underline hover:text-[var(--board-dark)]"
          target="_blank"
          rel="noopener noreferrer"
        >
          CSauthors.net/distance
        </a>
        .
      </footer>
    </main>
  );
}
