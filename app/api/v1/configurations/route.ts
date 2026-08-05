import { NextRequest, NextResponse } from "next/server";
import { ApiError, invalidBody, serviceUnavailable, toErrorBody } from "../../../../lib/api/errors";
import { getConfigurationRepository } from "../../../../lib/server/configurationRepository";
import { responseHeaders } from "../../../../lib/server/http";
import { log } from "../../../../lib/server/log";
import { requireWriteAccess } from "../../../../lib/server/writeAccess";
import { priceSelections, validateCreateConfiguration } from "../../../../lib/validation/configuration";
import { CUSTOMIZATION_SCHEMA_VERSION } from "../../../../lib/types/customization";

export const dynamic = "force-dynamic";

async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw invalidBody("Request body must be valid JSON.");
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireWriteAccess(request);
    const input = validateCreateConfiguration(await readJson(request));
    const saved = await (await getConfigurationRepository()).create(input);

    log("info", "configuration.created", request, {
      configurationId: saved.configurationId,
      vehicleId: saved.vehicleId,
      revision: saved.revision,
      schemaVersion: saved.schemaVersion,
    });

    return NextResponse.json(
      {
        schemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
        data: saved,
        pricing: { optionsTotal: priceSelections(saved.vehicleId, saved.selections) },
      },
      {
        status: 201,
        headers: responseHeaders(request, { Location: `/api/v1/configurations/${saved.configurationId}` }),
      },
    );
  } catch (err) {
    const apiError = err instanceof ApiError
      ? err
      : serviceUnavailable("The configuration service is temporarily unavailable.");

    log(err instanceof ApiError ? "warn" : "error", err instanceof ApiError
      ? "configuration.create_rejected"
      : "configuration.create_failed", request, {
      code: apiError.code,
      status: apiError.status,
      ...(err instanceof ApiError ? {} : { error: err instanceof Error ? err.message : String(err) }),
    });

    return NextResponse.json(toErrorBody(apiError), {
      status: apiError.status,
      headers: responseHeaders(request),
    });
  }
}
