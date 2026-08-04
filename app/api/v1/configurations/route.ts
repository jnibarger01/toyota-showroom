import { NextRequest, NextResponse } from "next/server";
import { ApiError, invalidBody, toErrorBody } from "../../../../lib/api/errors";
import { getConfigurationRepository } from "../../../../lib/server/configurationRepository";
import { responseHeaders } from "../../../../lib/server/http";
import { log } from "../../../../lib/server/log";
import { requireWriteAccess } from "../../../../lib/server/writeAccess";
import { priceSelections, validateCreateConfiguration } from "../../../../lib/validation/configuration";
import { CUSTOMIZATION_SCHEMA_VERSION } from "../../../../lib/types/customization";

/**
 * Configuration writes need a request-aware runtime. Unlike the catalog routes this one is not
 * `force-static`: the GitHub Pages export cannot serve it, and the Cloudflare Worker build can.
 */
export const dynamic = "force-dynamic";

async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw invalidBody("Request body must be valid JSON.");
  }
}

/** POST /api/v1/configurations — create a configuration and return the canonical saved record. */
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
        headers: responseHeaders(request, {
          Location: `/api/v1/configurations/${saved.configurationId}`,
        }),
      },
    );
  } catch (err) {
    if (err instanceof ApiError) {
      log("warn", "configuration.create_rejected", request, { code: err.code, status: err.status });
      return NextResponse.json(toErrorBody(err), {
        status: err.status,
        headers: responseHeaders(request),
      });
    }

    log("error", "configuration.create_failed", request, {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
