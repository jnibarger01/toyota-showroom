import { BuilderApp } from "../components/BuilderApp";
import { getAllVehicleSlugs } from "../../lib/data/vehicles";

export const dynamic = "force-static";

/** Pre-renders one route per catalog vehicle, mirroring the pattern used by app/api/v1/vehicles/[slug]. */
export function generateStaticParams() {
  return getAllVehicleSlugs().map((slug) => ({ slug }));
}

export default async function VehiclePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // `key` forces a clean remount on vehicle switches — see the comment on BuilderApp's bootstrap
  // effect for why that's the chosen reset strategy over clearing state imperatively in an effect.
  return <BuilderApp key={slug} vehicleSlug={slug} />;
}
