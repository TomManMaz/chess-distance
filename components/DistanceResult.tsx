"use client";

import type { DistanceResult as DistanceResultType } from "@/lib/types";

interface DistanceResultProps {
  result: DistanceResultType;
}

export default function DistanceResult({ result }: DistanceResultProps) {
  return (
    <div className="mt-8 p-6 bg-white rounded-xl border-2 border-[var(--board-dark)]/20 shadow-sm">
      <div className="text-center mb-6">
        <span className="text-5xl font-bold text-[var(--board-dark)]">
          {result.distance}
        </span>
        <p className="text-[var(--text-secondary)] mt-1">
          {result.distance === 0
            ? "Same player"
            : result.distance === 1
              ? "Direct opponents"
              : `${result.distance} degrees of separation`}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {result.path.map((node, i) => (
          <div key={node.player.id} className="flex items-center gap-2">
            <div className="text-center px-3 py-2 rounded-lg bg-[var(--board-light)] border border-[var(--board-dark)]/10">
              <div className="font-semibold text-sm">
                {node.player.title && (
                  <span className="text-[var(--accent)] mr-1">
                    {node.player.title}
                  </span>
                )}
                {node.player.name}
              </div>
              {node.player.federation && (
                <div className="text-xs text-[var(--text-secondary)]">
                  {node.player.federation}
                </div>
              )}
            </div>
            {node.game_count !== null && i < result.path.length - 1 && (
              <div className="flex flex-col items-center mx-1">
                <div className="text-xs text-[var(--text-secondary)]">
                  {node.game_count} {node.game_count === 1 ? "game" : "games"}
                </div>
                <div className="text-[var(--board-dark)] font-bold">&rarr;</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
