import { NextRequest, NextResponse } from "next/server";
import { getAllVehicleSlugs, getVehicleBySlug } from "../../../../../../lib/data/vehicles";
import { getOptionsForVehicle, isOptionAvailableForGrade } from "../../../../../../lib/data/options";
import { ApiError, notFound, invalidQuery } from "../../../../../../lib/api/errors";
import { CUSTOMIZATION_SCHEMA_VERSION } from "../../../../../../lib/types/customization";
import { errorResponse } from "../../../../../../lib/server/apiResponse";
import { withSecurityHeaders } from "../../../../../../lib/server/securityHeaders";

export const dynamic = "force-static";

export function generateStaticParams() {
  return getAllVehicleSlugs().map((slug) => ({ slug }));
}

/**
 * GET /api/v1/vehicles/:slug/options — the customization catalog for one vehicle.
 *
 * This is the only way the browser learns which node names, material names, and asset URLs an
 * option maps to. Those fields travel outward from the server and are never accepted back.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const vehicle = getVehicleBySlug(slug);
    if (!vehicle) throw notFound(`No vehicle found for slug "${slug}".`);

    const gradeId = request.nextUrl.searchParams.get("gradeId");
    if (gradeId && !vehicle.grades.some((grade) => grade.id === gradeId)) {
      throw invalidQuery(`Grade "${gradeId}" is not offered on the ${vehicle.year} ${vehicle.model}.`);
    }

    const options = getOptionsForVehicle(slug).filter(
      (option) => !gradeId || isOptionAvailableForGrade(option, gradeId),
    );

    return NextResponse.json(
      { schemaVersion: CUSTOMIZATION_SCHEMA_VERSION, vehicleId: slug, gradeId, data: options },
      {
        headers: withSecurityHeaders({
          "Cache-Control": "public, max-age=300",
          ETag: `"${slug}-options-${CUSTOMIZATION_SCHEMA_VERSION}-${options.length}"`,
        }),
      },
    );
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err);
    throw err;
  }
}
