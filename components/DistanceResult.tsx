"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import type { DistanceResult as DistanceResultType, Player } from "@/lib/types";
import { federationFlag } from "@/lib/federation-flag";
import { toDisplayName } from "@/lib/names";
import { nameToSlug } from "@/lib/slug";
import { apiUrl } from "@/lib/api-base";

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
      const res = await fetch(apiUrl("games", `a=${idA}&b=${idB}`));
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
            className="bg-[var(--bg-card)] rounded-xl shadow-xl max-w-md w-full p-6"
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
                    className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-2xl leading-none cursor-pointer"
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

      {/* ── Summary sentence with inline toggle ── */}
      {result.distance === 0 ? (
        <p className="text-lg text-[var(--board-dark)]">
          <PlayerLink player={first.player} className="font-bold" /> is the same player.
        </p>
      ) : (
        <div>
          <p className="text-lg text-[var(--board-dark)] leading-snug">
            <PlayerLink player={first.player} className="font-bold" />
            {" and "}
            <PlayerLink player={last.player} className="font-bold" />
            {" are "}
            <span className="font-bold text-[var(--accent)]">{result.distance}</span>
            {result.distance === 1 ? " opponent apart" : " opponents apart"}
            {" · "}
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-sm text-[var(--accent)] hover:text-[var(--board-dark)] transition-colors cursor-pointer"
            >
              {showDetails ? "hide path ▴" : "show path ▾"}
            </button>
          </p>

          {/* Path stats summary (CSauthors-style) */}
          {showDetails && (
            <div className="mt-2 text-sm text-[var(--text-secondary)] space-x-4">
              <span>
                <span className="font-medium text-[var(--board-dark)]">
                  {result.path.reduce((sum, node) => sum + (node.game_count ?? 0), 0)}
                </span>{" "}
                total games
              </span>
              <span>
                <span className="font-medium text-[var(--board-dark)]">{result.path.length}</span> players
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Warning if any player lacks birth year ── */}
      {result.distance > 0 && result.path.some(n => !n.player.birth_year) && (
        <p className="mt-2 text-sm text-amber-700">
          ⚠ Some players in this path have no recorded dates — the path may contain historical errors.
        </p>
      )}

      {/* ── Path details (expandable, CSauthors-style inline chain) ── */}
      {result.distance > 0 && (
        <>
          {showDetails && (
            <div className="mt-6 space-y-4">
              {/* Compact inline chain (CSauthors style) */}
              <div className="text-sm leading-relaxed text-[var(--board-dark)] space-y-2">
                <div>
                  <PlayerLink player={first.player} className="font-bold hover:underline" />
                </div>
                {result.path.map((node, i) => {
                  if (i >= result.path.length - 1) return null;
                  const next = result.path[i + 1];
                  const gc   = node.game_count ?? 0;
                  return (
                    <div key={`${node.player.id}-${next.player.id}`} className="space-y-1">
                      <div className="text-[var(--text-secondary)] ml-2">
                        played{" "}
                        <a
                          onClick={() => openGames(node.player.id, next.player.id)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-[var(--accent)]/10 text-[var(--accent)] rounded-md hover:bg-[var(--accent)]/20 cursor-pointer font-semibold text-xs"
                        >
                          {gc} {gc === 1 ? "game" : "games"}
                        </a>
                        {" with "}
                      </div>
                      {/* Time control tags */}
                      {(node.classical_count || node.rapid_count || node.blitz_count) && (
                        <div className="flex gap-1.5 ml-2 text-xs">
                          {node.classical_count ? (
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium">
                              {node.classical_count} classical
                            </span>
                          ) : null}
                          {node.rapid_count ? (
                            <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full font-medium">
                              {node.rapid_count} rapid
                            </span>
                          ) : null}
                          {node.blitz_count ? (
                            <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-medium">
                              {node.blitz_count} blitz
                            </span>
                          ) : null}
                        </div>
                      )}
                      <div className="ml-2">
                        <PlayerLink player={next.player} className="font-bold hover:underline" />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Expandable tree view (additional details via modal) */}
              <details className="text-xs text-[var(--text-secondary)] p-3 bg-[var(--board-light)]/30 rounded-lg">
                <summary className="cursor-pointer font-semibold text-[var(--board-dark)] hover:text-[var(--accent)]">
                  ▸ View game details
                </summary>
                <div className="mt-3 space-y-2">
                  <div>
                    <PlayerLink player={first.player} className="text-[var(--board-dark)] font-bold" />
                  </div>
                  {result.path.map((node, i) => {
                    if (i >= result.path.length - 1) return null;
                    const next = result.path[i + 1];
                    const gc   = node.game_count ?? 0;
                    return (
                      <div key={`${node.player.id}-${next.player.id}`}>
                        <div className="text-[var(--text-secondary)] pl-4 border-l-2 border-[var(--board-dark)]/20 ml-2 my-1">
                          played{" "}
                          <a
                            onClick={() => openGames(node.player.id, next.player.id)}
                            className="text-[var(--accent)] underline cursor-pointer hover:text-[var(--board-dark)] font-medium"
                          >
                            {gc} {gc === 1 ? "game" : "games"}
                          </a>
                          {" "}against
                        </div>
                        {i < result.path.length - 2 && (
                          <div className="mt-1">
                            <PlayerLink player={next.player} className="text-[var(--board-dark)] font-bold" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className="mt-1">
                    <PlayerLink player={last.player} className="text-[var(--board-dark)] font-bold" />
                  </div>
                </div>
              </details>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function formatPlayerName(title: string | null, name: string, federation?: string | null): string {
  const flag = federation ? federationFlag(federation) : "";
  const namePart = title ? `${title} ${toDisplayName(name)}` : toDisplayName(name);
  return flag ? `${flag} ${namePart}` : namePart;
}

function PlayerLink({ player, className }: { player: Player; className?: string }) {
  const label = formatPlayerName(player.title, player.name, player.federation);
  const inner = <>{label}</>;
  const slug = nameToSlug(player.name);
  return (
    <Link
      href={`/${slug}`}
      className={`hover:underline hover:text-[var(--accent)] transition-colors ${className ?? ""}`}
    >
      {inner}
    </Link>
  );
}
