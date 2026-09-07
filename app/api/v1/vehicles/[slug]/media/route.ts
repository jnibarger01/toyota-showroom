import { NextResponse } from "next/server";
import { getAllVehicleSlugs, getVehicleBySlug } from "../../../../../../lib/data/vehicles";
import { notFound } from "../../../../../../lib/api/errors";
import { VEHICLE_SCHEMA_VERSION } from "../../../../../../lib/types/vehicle";
import { errorResponse, withRouteTelemetry } from "../../../../../../lib/server/apiResponse";
import { withSecurityHeaders } from "../../../../../../lib/server/securityHeaders";
import { enforceCatalogReadRateLimit } from "../../../../../../lib/server/rateLimit";

export const dynamic = "force-static";

export function generateStaticParams() {
  return getAllVehicleSlugs().map((slug) => ({ slug }));
}

/** GET /api/v1/vehicles/:slug/media — hero/gallery/video/thumbnail/env-map/3D asset manifest (goal 8, 9). */
export const GET = withRouteTelemetry(
  "/api/v1/vehicles/:slug/media",
  "GET",
  async (request: Request, { params }: { params: Promise<{ slug: string }> }) => {
    await enforceCatalogReadRateLimit(request);
    const { slug } = await params;
    const vehicle = getVehicleBySlug(slug);

    if (!vehicle) return errorResponse(notFound(`No vehicle found for slug "${slug}"`));

    return NextResponse.json(
      {
        schemaVersion: VEHICLE_SCHEMA_VERSION,
        slug: vehicle.slug,
        media: vehicle.media,
        threeDConfig: vehicle.threeDConfig,
      },
      { headers: withSecurityHeaders({ "Cache-Control": "public, max-age=300", ETag: `"${vehicle.slug}-media-${vehicle.updatedAt}"` }) },
    );
  },
);
