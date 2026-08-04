import { NextResponse } from "next/server";
import { getAllVehicleSlugs, getVehicleBySlug } from "../../../../../lib/data/vehicles";
import { notFound, toErrorBody } from "../../../../../lib/api/errors";
import { VEHICLE_SCHEMA_VERSION } from "../../../../../lib/types/vehicle";

export const dynamic = "force-static";

/** Enumerates every vehicle slug so the static export can pre-render one JSON file per model. */
export function generateStaticParams() {
  return getAllVehicleSlugs().map((slug) => ({ slug }));
}

/** GET /api/v1/vehicles/:slug — full detail for one Toyota model (goal 3). */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const vehicle = getVehicleBySlug(slug);

  if (!vehicle) {
    const err = notFound(`No vehicle found for slug "${slug}"`);
    return NextResponse.json(toErrorBody(err), { status: err.status });
  }

  return NextResponse.json(
    { schemaVersion: VEHICLE_SCHEMA_VERSION, data: vehicle },
    {
      headers: {
        "Cache-Control": "public, max-age=300",
        ETag: `"${vehicle.slug}-${vehicle.updatedAt}"`,
      },
    },
  );
}
