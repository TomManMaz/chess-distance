"use client";

import { useState } from "react";
import type { DistanceResult as DistanceResultType } from "@/lib/types";

interface DistanceResultProps {
  result: DistanceResultType;
}

export default function DistanceResult({ result }: DistanceResultProps) {
  const [showDetails, setShowDetails] = useState(true);

  const first = result.path[0];
  const last = result.path[result.path.length - 1];

  return (
    <div className="mt-8 text-center">
      {/* Compact summary line */}
      <div className="text-[var(--text-secondary)] mb-2">
        Distance between{" "}
        <strong>{formatPlayerName(first.player.title, first.player.name)}</strong>
        {" "}and{" "}
        <strong>{formatPlayerName(last.player.title, last.player.name)}</strong>
      </div>

      {/* Chain: first player */}
      <div className="my-4">
        <span className="text-lg font-bold text-[var(--board-dark)]">
          {formatPlayerName(first.player.title, first.player.name)}
        </span>
      </div>

      {/* Toggle details */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="text-[var(--accent)] hover:text-[var(--board-dark)] transition-colors mb-2 cursor-pointer"
      >
        {showDetails ? (
          <>
            <span className="mr-1">&#x2296;</span>
            <em>hide details</em>
          </>
        ) : (
          <>
            <span className="mr-1">&#x2295;</span>
            <em>show details</em>
          </>
        )}
      </button>

      {/* Detailed path */}
      {showDetails && result.path.length > 1 && (
        <div className="my-4 inline-block text-left">
          {result.path.map((node, i) => {
            if (i >= result.path.length - 1) return null;
            const next = result.path[i + 1];
            const gc = node.game_count ?? 0;
            return (
              <div key={`${node.player.id}-${next.player.id}`} className="mb-3">
                <div className="text-[var(--text-secondary)] text-sm pl-4 border-l-2 border-[var(--board-dark)]/20 ml-2">
                  <span className="text-[var(--board-dark)] font-medium">
                    {formatPlayerName(node.player.title, node.player.name)}
                  </span>
                  <div className="my-1">
                    played{" "}
                    <a
                      className="text-[var(--accent)] underline cursor-pointer hover:text-[var(--board-dark)] font-medium"
                      title={`${gc} game${gc === 1 ? "" : "s"} between ${node.player.name} and ${next.player.name}`}
                    >
                      {gc} {gc === 1 ? "game" : "games"}
                    </a>
                    {" "}against
                  </div>
                  <span className="text-[var(--board-dark)] font-medium">
                    {formatPlayerName(next.player.title, next.player.name)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Last player */}
      <div className="my-4">
        <span className="text-lg font-bold text-[var(--board-dark)]">
          {formatPlayerName(last.player.title, last.player.name)}
        </span>
      </div>

      {/* Distance badge */}
      <div className="my-4">
        <span className="text-2xl font-bold text-[var(--board-dark)]">
          distance = {result.distance}
        </span>
        {result.distance > 0 && (
          <div className="text-sm text-[var(--text-secondary)] mt-1">
            {result.distance === 1
              ? "direct opponents"
              : `${result.distance} game${result.distance === 1 ? "" : "s"} apart`}
          </div>
        )}
      </div>
    </div>
  );
}

function formatPlayerName(title: string | null, name: string): string {
  return title ? `${title} ${name}` : name;
}
