import { NextRequest, NextResponse } from "next/server";
import { ApiError, invalidBody, notFound, toErrorBody } from "../../../../../lib/api/errors";
import { getConfigurationRepository } from "../../../../../lib/server/configurationRepository";
import { priceSelections, validatePatchConfiguration } from "../../../../../lib/validation/configuration";
import { CUSTOMIZATION_SCHEMA_VERSION } from "../../../../../lib/types/customization";

export const dynamic = "force-dynamic";

async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw invalidBody("Request body must be valid JSON.");
  }
}

async function requireConfiguration(configurationId: string) {
  const record = await getConfigurationRepository().get(configurationId);
  if (!record) throw notFound(`No configuration found with id "${configurationId}".`);
  return record;
}

function respond(record: Awaited<ReturnType<typeof requireConfiguration>>, status = 200) {
  return NextResponse.json(
    {
      schemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
      data: record,
      pricing: { optionsTotal: priceSelections(record.vehicleId, record.selections) },
    },
    {
      status,
      headers: { "Cache-Control": "no-store", ETag: `"${record.configurationId}-r${record.revision}"` },
    },
  );
}

/** GET /api/v1/configurations/:configurationId */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ configurationId: string }> }) {
  try {
    const { configurationId } = await params;
    return respond(await requireConfiguration(configurationId));
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json(toErrorBody(err), { status: err.status });
    throw err;
  }
}

/**
 * PATCH /api/v1/configurations/:configurationId
 *
 * Re-validates the incoming selections against the *stored* vehicle and grade rather than anything
 * in the request, so a client cannot widen its own compatibility rules by restating them.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ configurationId: string }> }) {
  try {
    const { configurationId } = await params;
    const existing = await requireConfiguration(configurationId);
    const patch = validatePatchConfiguration(await readJson(request), existing);
    return respond(await getConfigurationRepository().update(configurationId, patch));
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json(toErrorBody(err), { status: err.status });
    throw err;
  }
}

/** DELETE /api/v1/configurations/:configurationId */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ configurationId: string }> }) {
  try {
    const { configurationId } = await params;
    const deleted = await getConfigurationRepository().delete(configurationId);
    if (!deleted) throw notFound(`No configuration found with id "${configurationId}".`);
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json(toErrorBody(err), { status: err.status });
    throw err;
  }
}
