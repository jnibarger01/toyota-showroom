import type { Metadata } from "next";
import { BuilderApp } from "../components/BuilderApp";
import { PremiumViewerControls } from "../components/PremiumViewerControls";
import { getAllVehicleSlugs, getVehicleBySlug } from "../../lib/data/vehicles";
import { absolutePageUrl } from "../../lib/site";
import { buildSharePreview, sharePreviewToMetadata } from "../../lib/showroom/openGraph";

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
  if (!vehicle) {
    return {
      title: "Toyota Showroom",
      alternates: { canonical: absolutePageUrl(slug) },
    };
  }

  // Static export cannot read `?c=` at request time — vehicle-level OG (hero still + model copy)
  // is baked here. Worker share-card (#41) supplies grade/paint/wheels for crawler unfurls.
  const preview = buildSharePreview({ vehicle });
  return {
    ...sharePreviewToMetadata(preview),
    alternates: {
      canonical: absolutePageUrl(slug),
    },
  };
}

export default async function VehiclePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const vehicle = getVehicleBySlug(slug);
  const hasDetailedModel = Boolean(vehicle?.threeDConfig.hasModel && vehicle.threeDConfig.modelUrl);
  // `key` forces a clean remount on vehicle switches — see the comment on BuilderApp's bootstrap
  // effect for why that's the chosen reset strategy over clearing state imperatively in an effect.
  return (
    <>
      <BuilderApp key={slug} vehicleSlug={slug} />
      {hasDetailedModel ? <PremiumViewerControls /> : null}
    </>
  );
}
