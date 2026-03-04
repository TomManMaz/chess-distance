import { getPlayerData, PlayerData } from "@/lib/player";
import { notFound } from "next/navigation";

interface Props {
  params: { id: string };
}

export default async function PlayerPage({ params }: Props) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return notFound();

  const player = await getPlayerData(id);
  if (!player) return notFound();

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">{player.name}</h1>
      <ul className="mt-2 list-disc list-inside">
        {player.birth_year && <li>Birth year: {player.birth_year}</li>}
        {player.death_year && <li>Death year: {player.death_year}</li>}
        {player.federation && <li>Federation: {player.federation}</li>}
        {player.fide_id && <li>FIDE ID: {player.fide_id}</li>}
        {player.total_games !== null && (
          <li>Total games (across all time controls): {player.total_games}</li>
        )}
      </ul>
    </div>
  );
}
