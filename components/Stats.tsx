"use client";

import { useState, useEffect } from "react";
import type { StatsData } from "@/lib/types";

function ordinal(n: number): string {
  const s = n % 100;
  if (s >= 11 && s <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}

function formatLastUpdated(dateStr: string): string {
  // dateStr is "YYYY-MM-DD"; use noon UTC to avoid any timezone shift
  const d = new Date(dateStr + "T12:00:00Z");
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const month   = d.toLocaleDateString("en-GB", { month: "long",   timeZone: "UTC" });
  return `${weekday}, ${ordinal(d.getUTCDate())} ${month} ${d.getUTCFullYear()}`;
}

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
    <div className="mt-12">
      <div className="grid grid-cols-3 gap-4 text-center">
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

      {stats.last_updated && (
        <div className="mt-3 text-center text-xs text-[var(--text-secondary)]">
          Last dataset update: {formatLastUpdated(stats.last_updated)}
        </div>
      )}
    </div>
  );
}
