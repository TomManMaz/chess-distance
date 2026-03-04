import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getPlayerBySlug } from "@/lib/player";
import { findShortestPath } from "@/lib/bfs";
import { toDisplayName } from "@/lib/names";
import DistanceResultComponent from "@/components/DistanceResult";

interface Props {
  params: Promise<{ player: string; playerB: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { player: slugA, playerB: slugB } = await params;
  const [pA, pB] = await Promise.all([
    getPlayerBySlug(slugA),
    getPlayerBySlug(slugB),
  ]);
  if (!pA || !pB) return { title: "Player not found" };
  const nameA = toDisplayName(pA.name);
  const nameB = toDisplayName(pB.name);
  return {
    title: `${nameA} → ${nameB} — Chess Distance`,
    description: `Shortest opponent path from ${nameA} to ${nameB}`,
    openGraph: {
      title: `${nameA} → ${nameB}`,
      description: `Find the chess opponent path between ${nameA} and ${nameB}`,
    },
  };
}

export default async function PairPage({ params }: Props) {
  const { player: slugA, playerB: slugB } = await params;

  const [pA, pB] = await Promise.all([
    getPlayerBySlug(slugA),
    getPlayerBySlug(slugB),
  ]);
  if (!pA || !pB) return notFound();

  const result = await findShortestPath(Number(pA.id), Number(pB.id));

  const nameA = toDisplayName(pA.name);
  const nameB = toDisplayName(pB.name);

  return (
    <main className="max-w-2xl mx-auto px-4 py-12">
      <div className="mb-6">
        <Link
          href="/"
          className="text-sm text-[var(--accent)] hover:text-[var(--board-dark)] underline transition-colors"
        >
          ← Calculate another distance
        </Link>
      </div>

      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-[var(--board-dark)]">
          {nameA} → {nameB}
        </h1>
      </div>

      {result ? (
        <DistanceResultComponent result={result} />
      ) : (
        <div className="mt-8 p-4 bg-red-50 text-red-700 rounded-lg border border-red-200 text-center">
          No opponent path found between {nameA} and {nameB}.
        </div>
      )}

      <div className="mt-8 text-center">
        <Link
          href="/"
          className="inline-block py-2 px-5 bg-[var(--board-dark)] text-white font-semibold
                     rounded-lg hover:bg-[var(--board-dark)]/90 transition-all text-sm"
        >
          Calculate another
        </Link>
      </div>
    </main>
  );
}
