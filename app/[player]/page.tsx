import { cache } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getPlayerBySlug, getTopNeighbors } from "@/lib/player";
import { federationFlag } from "@/lib/federation-flag";
import { toDisplayName } from "@/lib/names";
import { nameToSlug } from "@/lib/slug";

// cache() deduplicates identical calls within a single request,
// so generateMetadata and the page component share one DB round-trip.
const getCachedPlayer = cache(getPlayerBySlug);

interface Props {
  params: Promise<{ player: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { player: slug } = await params;
  const p = await getCachedPlayer(slug);
  if (!p) return { title: "Player not found" };
  const display = toDisplayName(p.name);
  return {
    title: `${display} — Chess Distance`,
    description: `Chess Distance player profile for ${display}`,
  };
}

export default async function PlayerPage({ params }: Props) {
  const { player: slug } = await params;

  const player = await getCachedPlayer(slug);
  if (!player) return notFound();

  // player.id is typed as number but CockroachDB returns BigInt at runtime.
  // Pass it directly so postgres.js sends the exact 64-bit value (no precision loss).
  const neighbors = await getTopNeighbors(player.id as unknown as bigint);

  const display = toDisplayName(player.name);
  const flag = player.federation ? federationFlag(player.federation) : null;
  const titlePrefix = player.title ? `${player.title} ` : "";

  let years: string | null = null;
  if (player.birth_year) {
    years = player.death_year
      ? `${player.birth_year}–${player.death_year}`
      : `b. ${player.birth_year}`;
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-12">
      <div className="mb-6">
        <Link
          href="/"
          className="text-sm text-[var(--accent)] hover:text-[var(--board-dark)] underline transition-colors"
        >
          ← Back to distance calculator
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-8">
        <h1 className="text-3xl font-bold text-[var(--board-dark)] mb-1">
          {titlePrefix}{display}
        </h1>

        {years && (
          <p className="text-[var(--text-secondary)] text-sm mb-4">{years}</p>
        )}

        <dl className="mt-4 space-y-2 text-sm">
          {player.federation && (
            <div className="flex gap-2">
              <dt className="text-[var(--text-secondary)] w-36 shrink-0">Federation</dt>
              <dd className="font-medium text-[var(--board-dark)]">
                {flag && <span className="mr-1">{flag}</span>}
                {player.federation}
              </dd>
            </div>
          )}
          {player.birth_year && (
            <div className="flex gap-2">
              <dt className="text-[var(--text-secondary)] w-36 shrink-0">Birth year</dt>
              <dd className="font-medium text-[var(--board-dark)]">{player.birth_year}</dd>
            </div>
          )}
          {player.fide_id && (
            <div className="flex gap-2">
              <dt className="text-[var(--text-secondary)] w-36 shrink-0">FIDE ID</dt>
              <dd className="font-medium text-[var(--board-dark)]">
                <a
                  href={`https://ratings.fide.com/profile/${player.fide_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--accent)] underline hover:text-[var(--board-dark)] transition-colors"
                >
                  {player.fide_id}
                </a>
              </dd>
            </div>
          )}
          {player.total_games != null && (
            <div className="flex gap-2">
              <dt className="text-[var(--text-secondary)] w-36 shrink-0">Recorded games</dt>
              <dd className="font-medium text-[var(--board-dark)]">
                {Number(player.total_games).toLocaleString()}
              </dd>
            </div>
          )}
        </dl>

        {neighbors.length > 0 && (
          <div className="mt-8">
            <h2 className="text-base font-semibold text-[var(--board-dark)] mb-3">
              Top opponents
            </h2>
            <ol className="space-y-1.5">
              {neighbors.map((nb, i) => {
                const nbDisplay = toDisplayName(nb.name);
                const nbTitlePrefix = nb.title ? `${nb.title} ` : "";
                const nbFlag = nb.federation ? federationFlag(nb.federation) : null;
                const nbSlug = nb.slug ?? nameToSlug(nb.name);
                return (
                  <li key={Number(nb.id)} className="flex items-center gap-2 text-sm">
                    <span className="text-[var(--text-secondary)] w-5 text-right shrink-0">
                      {i + 1}.
                    </span>
                    <Link
                      href={`/${nbSlug}`}
                      className="text-[var(--accent)] hover:text-[var(--board-dark)] hover:underline transition-colors"
                    >
                      {nbFlag && <span className="mr-1">{nbFlag}</span>}
                      {nbTitlePrefix}{nbDisplay}
                    </Link>
                    <span className="text-[var(--text-secondary)]">
                      — {Number(nb.game_count).toLocaleString()} {Number(nb.game_count) === 1 ? "game" : "games"}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        <div className="mt-8">
          <Link
            href={`/?player=${encodeURIComponent(player.name)}&id=${player.id}`}
            className="inline-block py-2 px-5 bg-[var(--board-dark)] text-white font-semibold
                       rounded-lg hover:bg-[var(--board-dark)]/90 transition-all text-sm"
          >
            Find distance from {display}
          </Link>
        </div>
      </div>
    </main>
  );
}
