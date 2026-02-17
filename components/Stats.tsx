"use client";

import { useState, useEffect } from "react";
import type { StatsData } from "@/lib/types";

export default function Stats() {
  const [stats, setStats] = useState<StatsData | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((res) => res.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  if (!stats) return null;

  return (
    <div className="mt-12 grid grid-cols-3 gap-4 text-center">
      <div className="p-4 bg-white rounded-lg border border-gray-200">
        <div className="text-2xl font-bold text-[var(--board-dark)]">
          {stats.total_players.toLocaleString()}
        </div>
        <div className="text-sm text-[var(--text-secondary)]">Players</div>
      </div>
      <div className="p-4 bg-white rounded-lg border border-gray-200">
        <div className="text-2xl font-bold text-[var(--board-dark)]">
          {stats.total_games.toLocaleString()}
        </div>
        <div className="text-sm text-[var(--text-secondary)]">Games</div>
      </div>
      <div className="p-4 bg-white rounded-lg border border-gray-200">
        <div className="text-2xl font-bold text-[var(--board-dark)]">
          {stats.total_opponent_pairs.toLocaleString()}
        </div>
        <div className="text-sm text-[var(--text-secondary)]">
          Opponent Pairs
        </div>
      </div>
    </div>
  );
}
