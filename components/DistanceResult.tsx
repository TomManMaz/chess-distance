"use client";

import { useState, useCallback } from "react";
import type { DistanceResult as DistanceResultType, Player } from "@/lib/types";
import { federationFlag } from "@/lib/federation-flag";

interface DistanceResultProps {
  result: DistanceResultType;
}

interface GameDetail {
  game_count: number;
  first_game_date: string | null;
  last_game_date: string | null;
  classical_count: number;
  rapid_count: number;
  blitz_count: number;
  event_sample: string | null;
  player_a: { name: string; title: string | null };
  player_b: { name: string; title: string | null };
}

export default function DistanceResult({ result }: DistanceResultProps) {
  const [showDetails, setShowDetails] = useState(true);
  const [modal, setModal] = useState<GameDetail | null>(null);
  const [modalLoading, setModalLoading] = useState(false);

  const first = result.path[0];
  const last  = result.path[result.path.length - 1];

  const openGames = useCallback(async (idA: number, idB: number) => {
    setModalLoading(true);
    try {
      const res = await fetch(`/api/games?a=${idA}&b=${idB}`);
      if (res.ok) setModal(await res.json());
    } finally {
      setModalLoading(false);
    }
  }, []);

  return (
    <div className="mt-8">
      {/* ── Modal overlay ── */}
      {(modal || modalLoading) && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => { setModal(null); setModalLoading(false); }}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {modalLoading ? (
              <div className="text-center py-8 text-[var(--text-secondary)]">Loading…</div>
            ) : modal ? (
              <>
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-bold text-[var(--board-dark)]">Games between players</h3>
                  <button
                    onClick={() => setModal(null)}
                    className="text-gray-400 hover:text-gray-600 text-2xl leading-none cursor-pointer"
                  >
                    &times;
                  </button>
                </div>
                <div className="space-y-3">
                  <div className="text-center py-4 bg-[var(--board-light)] rounded-lg">
                    <div className="font-medium text-[var(--board-dark)]">
                      {formatPlayerName(modal.player_a.title, modal.player_a.name)}
                    </div>
                    <div className="text-sm text-[var(--text-secondary)] my-1">vs</div>
                    <div className="font-medium text-[var(--board-dark)]">
                      {formatPlayerName(modal.player_b.title, modal.player_b.name)}
                    </div>
                  </div>
                  <div className="text-center">
                    <span className="text-3xl font-bold text-[var(--accent)]">{modal.game_count}</span>
                    <span className="text-[var(--text-secondary)] ml-2">
                      {modal.game_count === 1 ? "game" : "games"} played
                    </span>
                  </div>
                  {(modal.classical_count > 0 || modal.rapid_count > 0 || modal.blitz_count > 0) && (
                    <div className="flex justify-center gap-4 text-sm text-[var(--text-secondary)]">
                      {modal.classical_count > 0 && (
                        <span><span className="font-medium text-[var(--board-dark)]">{modal.classical_count}</span> classical</span>
                      )}
                      {modal.rapid_count > 0 && (
                        <span><span className="font-medium text-[var(--board-dark)]">{modal.rapid_count}</span> rapid</span>
                      )}
                      {modal.blitz_count > 0 && (
                        <span><span className="font-medium text-[var(--board-dark)]">{modal.blitz_count}</span> blitz</span>
                      )}
                    </div>
                  )}
                  {modal.event_sample && (
                    <div className="text-sm text-[var(--text-secondary)] text-center italic">e.g. {modal.event_sample}</div>
                  )}
                  {(modal.first_game_date || modal.last_game_date) && (
                    <div className="text-sm text-[var(--text-secondary)] text-center">
                      {modal.first_game_date && modal.last_game_date && modal.first_game_date !== modal.last_game_date
                        ? `${modal.first_game_date} – ${modal.last_game_date}`
                        : modal.first_game_date || modal.last_game_date}
                    </div>
                  )}
                </div>
                <div className="mt-6 text-center">
                  <button
                    onClick={() => setModal(null)}
                    className="px-6 py-2 bg-[var(--board-dark)] text-white rounded-lg hover:bg-[var(--board-dark)]/90 cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* ── Summary sentence (csauthors-style) ── */}
      {result.distance === 0 ? (
        <p className="text-lg text-[var(--board-dark)]">
          <PlayerLink player={first.player} className="font-bold" /> is the same player.
        </p>
      ) : (
        <p className="text-lg text-[var(--board-dark)] leading-snug">
          <PlayerLink player={first.player} className="font-bold" />
          {" and "}
          <PlayerLink player={last.player} className="font-bold" />
          {" are "}
          <span className="font-bold text-[var(--accent)]">{result.distance}</span>
          {result.distance === 1 ? " opponent apart." : " opponents apart."}
        </p>
      )}

      {/* ── Path details (expandable) ── */}
      {result.distance > 0 && (
        <>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="mt-3 text-sm text-[var(--accent)] hover:text-[var(--board-dark)] transition-colors cursor-pointer"
          >
            {showDetails ? "▾ hide path" : "▸ show path"}
          </button>

          {showDetails && (
            <div className="mt-4 inline-block text-left">
              {/* First player */}
              <div className="mb-1">
                <PlayerLink player={first.player} className="text-lg font-bold text-[var(--board-dark)]" />
              </div>

              {result.path.map((node, i) => {
                if (i >= result.path.length - 1) return null;
                const next = result.path[i + 1];
                const gc   = node.game_count ?? 0;
                return (
                  <div key={`${node.player.id}-${next.player.id}`}>
                    {/* Connector */}
                    <div className="text-[var(--text-secondary)] text-sm pl-4 border-l-2 border-[var(--board-dark)]/20 ml-2 my-1">
                      played{" "}
                      <a
                        onClick={() => openGames(node.player.id, next.player.id)}
                        className="text-[var(--accent)] underline cursor-pointer hover:text-[var(--board-dark)] font-medium"
                      >
                        {gc} {gc === 1 ? "game" : "games"}
                      </a>
                      {" "}against
                    </div>
                    {/* Next player (skip the last one — rendered below) */}
                    {i < result.path.length - 2 && (
                      <div className="mb-1">
                        <PlayerLink player={next.player} className="text-lg font-bold text-[var(--board-dark)]" />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Last player */}
              <div className="mt-1">
                <PlayerLink player={last.player} className="text-lg font-bold text-[var(--board-dark)]" />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function formatPlayerName(title: string | null, name: string, federation?: string | null): string {
  const flag = federation ? federationFlag(federation) : "";
  const namePart = title ? `${title} ${name}` : name;
  return flag ? `${flag} ${namePart}` : namePart;
}

function PlayerYears({ player }: { player: Player }) {
  if (!player.birth_year) return null;
  const years = player.death_year
    ? `${player.birth_year}–${player.death_year}`
    : `b. ${player.birth_year}`;
  return (
    <span className="ml-1.5 text-sm font-normal text-[var(--text-secondary)]">({years})</span>
  );
}

function PlayerLink({ player, className }: { player: Player; className?: string }) {
  const label = formatPlayerName(player.title, player.name, player.federation);
  const inner = <>{label}<PlayerYears player={player} /></>;
  if (player.fide_id) {
    return (
      <a
        href={`https://ratings.fide.com/profile/${player.fide_id}`}
        target="_blank"
        rel="noopener noreferrer"
        className={`hover:underline hover:text-[var(--accent)] transition-colors ${className ?? ""}`}
      >
        {inner}
      </a>
    );
  }
  return <span className={className}>{inner}</span>;
}
