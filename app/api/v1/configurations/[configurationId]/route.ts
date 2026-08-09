import { NextRequest, NextResponse } from "next/server";
import { ApiError, invalidBody, notFound, serviceUnavailable, toErrorBody } from "../../../../../lib/api/errors";
import {
  getConfigurationRepository,
  type ConfigurationRepository,
} from "../../../../../lib/server/configurationRepository";
import { responseHeaders } from "../../../../../lib/server/http";
import { log } from "../../../../../lib/server/log";
import { requireWriteAccess } from "../../../../../lib/server/writeAccess";
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

async function requireConfiguration(repository: ConfigurationRepository, configurationId: string) {
  const record = await repository.get(configurationId);
  if (!record) throw notFound(`No configuration found with id "${configurationId}".`);
  return record;
}

function respond(
  request: NextRequest,
  record: Awaited<ReturnType<typeof requireConfiguration>>,
  status = 200,
) {
  return NextResponse.json(
    {
      schemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
      data: record,
      pricing: { optionsTotal: priceSelections(record.vehicleId, record.selections) },
    },
    {
      status,
      headers: responseHeaders(request, {
        ETag: `"${record.configurationId}-r${record.revision}"`,
      }),
    },
  );
}

function apiErrorResponse(request: NextRequest, err: ApiError) {
  return NextResponse.json(toErrorBody(err), {
    status: err.status,
    headers: responseHeaders(request),
  });
}

/** GET /api/v1/configurations/:configurationId */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ configurationId: string }> },
) {
  try {
    const { configurationId } = await params;
    const repository = await getConfigurationRepository();
    return respond(request, await requireConfiguration(repository, configurationId));
  } catch (err) {
    const apiError = err instanceof ApiError
      ? err
      : serviceUnavailable("The configuration service is temporarily unavailable.");
    log(err instanceof ApiError ? "warn" : "error", "configuration.read_failed", request, {
      code: apiError.code,
      status: apiError.status,
      ...(err instanceof ApiError ? {} : { error: err instanceof Error ? err.message : String(err) }),
    });
    return apiErrorResponse(request, apiError);
  }
}

/**
 * PATCH /api/v1/configurations/:configurationId
 *
 * Re-validates the incoming selections against the stored vehicle and grade rather than anything
 * in the request, so a client cannot widen its own compatibility rules by restating them.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ configurationId: string }> },
) {
  try {
    await requireWriteAccess(request);
    const { configurationId } = await params;
    const repository = await getConfigurationRepository();
    const existing = await requireConfiguration(repository, configurationId);
    const patch = validatePatchConfiguration(await readJson(request), existing);
    const updated = await repository.update(configurationId, patch);

    log("info", "configuration.updated", request, {
      configurationId,
      revision: updated.revision,
      schemaVersion: updated.schemaVersion,
    });

    return respond(request, updated);
  } catch (err) {
    if (err instanceof ApiError) {
      log("warn", "configuration.update_rejected", request, { code: err.code, status: err.status });
      return apiErrorResponse(request, err);
    }
    const apiError = serviceUnavailable("The configuration service is temporarily unavailable.");
    log("error", "configuration.update_failed", request, {
      code: apiError.code,
      status: apiError.status,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiErrorResponse(request, apiError);
  }
}

/** DELETE /api/v1/configurations/:configurationId */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ configurationId: string }> },
) {
  try {
    await requireWriteAccess(request);
    const { configurationId } = await params;
    const deleted = await (await getConfigurationRepository()).delete(configurationId);
    if (!deleted) throw notFound(`No configuration found with id "${configurationId}".`);

    log("info", "configuration.deleted", request, { configurationId });
    return new NextResponse(null, { status: 204, headers: responseHeaders(request) });
  } catch (err) {
    if (err instanceof ApiError) {
      log("warn", "configuration.delete_rejected", request, { code: err.code, status: err.status });
      return apiErrorResponse(request, err);
    }
    const apiError = serviceUnavailable("The configuration service is temporarily unavailable.");
    log("error", "configuration.delete_failed", request, {
      code: apiError.code,
      status: apiError.status,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiErrorResponse(request, apiError);
  }
}
