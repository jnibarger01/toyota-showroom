import { NextResponse } from "next/server";
import { VEHICLES } from "../../../../lib/data/vehicles";
import { VEHICLE_SCHEMA_VERSION } from "../../../../lib/types/vehicle";
import { withSecurityHeaders } from "../../../../lib/server/securityHeaders";

export const dynamic = "force-static";

/** GET /api/v1/health — reliability check (goal 15): catalog is loaded and schema version is reported. */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      schemaVersion: VEHICLE_SCHEMA_VERSION,
      vehicleCount: VEHICLES.length,
      timestamp: new Date().toISOString(),
    },
    { headers: withSecurityHeaders({ "Cache-Control": "no-store" }) },
  );
}
