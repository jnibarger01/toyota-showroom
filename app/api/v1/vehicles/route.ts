import { NextRequest, NextResponse } from "next/server";
import { VEHICLES } from "../../../../lib/data/vehicles";
import { queryVehicles } from "../../../../lib/api/query";
import { parseVehicleQuery } from "../../../../lib/validation/vehicle-query";
import { ApiError, toErrorBody } from "../../../../lib/api/errors";
import { VEHICLE_SCHEMA_VERSION } from "../../../../lib/types/vehicle";

export const dynamic = "force-static";

/**
 * GET /api/v1/vehicles — Toyota lineup with filtering + pagination when served by a
 * query-aware runtime. GitHub Pages serves the generated `vehicles.json` catalog snapshot
 * instead; consumers there must use `lib/api/client.ts`, which filters and paginates the
 * complete catalog client-side.
 */
export async function GET(request: NextRequest) {
  try {
    const { filters, pagination } = parseVehicleQuery(request.nextUrl.searchParams);
    const result = queryVehicles(VEHICLES, filters, pagination);
    return NextResponse.json(
      { schemaVersion: VEHICLE_SCHEMA_VERSION, ...result },
      {
        headers: {
          "Cache-Control": "public, max-age=300",
          ETag: `"vehicles-${VEHICLES.length}-${VEHICLE_SCHEMA_VERSION}"`,
        },
      },
    );
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(toErrorBody(err), { status: err.status });
    }
    throw err;
  }
}
