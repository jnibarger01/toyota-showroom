import { NextRequest, NextResponse } from "next/server";
import { VEHICLES } from "../../../../lib/data/vehicles";
import { queryVehicles } from "../../../../lib/api/query";
import { parseVehicleQuery } from "../../../../lib/validation/vehicle-query";
import { ApiError, toErrorBody } from "../../../../lib/api/errors";
import { VEHICLE_SCHEMA_VERSION } from "../../../../lib/types/vehicle";

export const dynamic = "force-static";

/**
 * GET /api/v1/vehicles — Toyota lineup with filtering + pagination (goal 2).
 * This project deploys as a static export (see next.config.mjs), so this route is
 * pre-rendered once at build time with no query string. Query-string filtering and
 * pagination are still fully implemented here via `queryVehicles`/`parseVehicleQuery`
 * and are exercised client-side against this payload by `lib/api/client.ts`, which
 * keeps the same contract if this route is ever served dynamically instead.
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
