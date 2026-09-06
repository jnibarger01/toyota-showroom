import { NextRequest, NextResponse } from "next/server";
import { VEHICLES } from "../../../../lib/data/vehicles";
import { queryVehicles } from "../../../../lib/api/query";
import { parseVehicleQuery } from "../../../../lib/validation/vehicle-query";

import { VEHICLE_SCHEMA_VERSION } from "../../../../lib/types/vehicle";
import { withRouteTelemetry } from "../../../../lib/server/apiResponse";
import { withSecurityHeaders } from "../../../../lib/server/securityHeaders";
import { enforceCatalogReadRateLimit } from "../../../../lib/server/rateLimit";

export const dynamic = "force-static";

/**
 * GET /api/v1/vehicles — Toyota lineup with filtering + pagination when served by a
 * query-aware runtime. GitHub Pages serves the generated `vehicles.json` catalog snapshot
 * instead; consumers there must use `lib/api/client.ts`, which filters and paginates the
 * complete catalog client-side.
 */
export const GET = withRouteTelemetry(
  "/api/v1/vehicles",
  "GET",
  async (request: NextRequest) => {
    await enforceCatalogReadRateLimit(request);
      const { filters, pagination } = parseVehicleQuery(request.nextUrl.searchParams);
      const result = queryVehicles(VEHICLES, filters, pagination);
      return NextResponse.json(
        { schemaVersion: VEHICLE_SCHEMA_VERSION, ...result },
        {
          headers: withSecurityHeaders({
            "Cache-Control": "public, max-age=300",
            ETag: `"vehicles-${VEHICLES.length}-${VEHICLE_SCHEMA_VERSION}"`,
          }),
        },
      );
  },
);
