import { NextResponse } from "next/server";
import { getAllVehicleSlugs, getVehicleBySlug } from "../../../../../lib/data/vehicles";
import { notFound } from "../../../../../lib/api/errors";
import { VEHICLE_SCHEMA_VERSION } from "../../../../../lib/types/vehicle";
import { errorResponse, withRouteTelemetry } from "../../../../../lib/server/apiResponse";
import { withSecurityHeaders } from "../../../../../lib/server/securityHeaders";

export const dynamic = "force-static";

/** Enumerates every vehicle slug so the static export can pre-render one JSON file per model. */
export function generateStaticParams() {
  return getAllVehicleSlugs().map((slug) => ({ slug }));
}

/** GET /api/v1/vehicles/:slug — full detail for one Toyota model (goal 3). */
export const GET = withRouteTelemetry(
  "/api/v1/vehicles/:slug",
  "GET",
  async (_request: Request, { params }: { params: Promise<{ slug: string }> }) => {
    const { slug } = await params;
    const vehicle = getVehicleBySlug(slug);

    if (!vehicle) return errorResponse(notFound(`No vehicle found for slug "${slug}"`));

    return NextResponse.json(
      { schemaVersion: VEHICLE_SCHEMA_VERSION, data: vehicle },
      {
        headers: withSecurityHeaders({
          "Cache-Control": "public, max-age=300",
          ETag: `"${vehicle.slug}-${vehicle.updatedAt}"`,
        }),
      },
    );
  },
);
