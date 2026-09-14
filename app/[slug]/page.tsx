import type { Metadata } from "next";
import { BuilderApp } from "../components/BuilderApp";
import { PremiumViewerControls } from "../components/PremiumViewerControls";
import { getAllVehicleSlugs, getVehicleBySlug } from "../../lib/data/vehicles";
import { absolutePageUrl } from "../../lib/site";

export const dynamic = "force-static";

/** Pre-renders one route per catalog vehicle, mirroring the pattern used by app/api/v1/vehicles/[slug]. */
export function generateStaticParams() {
  return getAllVehicleSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const vehicle = getVehicleBySlug(slug);
  return {
    title: vehicle ? `${vehicle.year} ${vehicle.model} | Toyota Showroom` : "Toyota Showroom",
    alternates: {
      canonical: absolutePageUrl(slug),
    },
  };
}

export default async function VehiclePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // `key` forces a clean remount on vehicle switches — see the comment on BuilderApp's bootstrap
  // effect for why that's the chosen reset strategy over clearing state imperatively in an effect.
  return (
    <>
      <BuilderApp key={slug} vehicleSlug={slug} />
      <PremiumViewerControls />
    </>
  );
}
