import { NextRequest, NextResponse } from "next/server";
import { ApiError, invalidBody, notFound } from "../../../../../lib/api/errors";
import { getConfigurationRepository } from "../../../../../lib/server/configurationRepository";
import { priceSelections, validatePatchConfiguration } from "../../../../../lib/validation/configuration";
import { CUSTOMIZATION_SCHEMA_VERSION, type VehicleConfiguration } from "../../../../../lib/types/customization";
import { enforceConfigWriteRateLimit } from "../../../../../lib/server/rateLimit";
import { errorResponse } from "../../../../../lib/server/apiResponse";
import { withSecurityHeaders } from "../../../../../lib/server/securityHeaders";

export const dynamic = "force-dynamic";

/** Header the caller presents its capability token through — see lib/shared/ownerToken.ts. */
const OWNER_TOKEN_HEADER = "x-owner-token";

async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw invalidBody("Request body must be valid JSON.");
  }
}

async function requireConfiguration(configurationId: string): Promise<VehicleConfiguration> {
  const record = await getConfigurationRepository().get(configurationId);
  if (!record) throw notFound(`No configuration found with id "${configurationId}".`);
  return record;
}

function ownerTokenFrom(request: NextRequest): string {
  return request.headers.get(OWNER_TOKEN_HEADER) ?? "";
}

function respond(record: VehicleConfiguration, status = 200) {
  return NextResponse.json(
    {
      schemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
      data: record,
      pricing: { optionsTotal: priceSelections(record.vehicleId, record.selections) },
    },
    {
      status,
      headers: withSecurityHeaders({ "Cache-Control": "no-store", ETag: `"${record.configurationId}-r${record.revision}"` }),
    },
  );
}

/**
 * GET /api/v1/configurations/:configurationId — unauthenticated and unthrottled; this is what
 * sharing depends on. Reads aren't the abuse vector rate limiting exists for.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ configurationId: string }> }) {
  try {
    const { configurationId } = await params;
    return respond(await requireConfiguration(configurationId));
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err);
    throw err;
  }
}

/**
 * PATCH /api/v1/configurations/:configurationId
 *
 * Re-validates the incoming selections against the *stored* vehicle and grade rather than anything
 * in the request, so a client cannot widen its own compatibility rules by restating them. Requires
 * the `X-Owner-Token` header to match the record's owner (lib/shared/ownerToken.ts); the repository
 * throws a 403 `forbidden()` before touching the record if it doesn't, existence-checked first so a
 * wrong token on an unknown id still reports 404, not 403.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ configurationId: string }> }) {
  try {
    await enforceConfigWriteRateLimit(request);
    const { configurationId } = await params;
    const existing = await requireConfiguration(configurationId);
    const patch = validatePatchConfiguration(await readJson(request), existing);
    return respond(await getConfigurationRepository().update(configurationId, patch, ownerTokenFrom(request)));
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err);
    throw err;
  }
}

/** DELETE /api/v1/configurations/:configurationId — same `X-Owner-Token` requirement as PATCH. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ configurationId: string }> }) {
  try {
    await enforceConfigWriteRateLimit(request);
    const { configurationId } = await params;
    const deleted = await getConfigurationRepository().delete(configurationId, ownerTokenFrom(request));
    if (!deleted) throw notFound(`No configuration found with id "${configurationId}".`);
    return new NextResponse(null, { status: 204, headers: withSecurityHeaders({ "Cache-Control": "no-store" }) });
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err);
    throw err;
  }
}
