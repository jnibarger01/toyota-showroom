import { NextRequest, NextResponse } from "next/server";
import { ApiError, invalidBody, toErrorBody } from "../../../../lib/api/errors";
import { getConfigurationRepository } from "../../../../lib/server/configurationRepository";
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
    const input = validateCreateConfiguration(await readJson(request));
    const saved = await getConfigurationRepository().create(input);

    return NextResponse.json(
      {
        schemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
        data: saved,
        pricing: { optionsTotal: priceSelections(saved.vehicleId, saved.selections) },
      },
      {
        status: 201,
        headers: {
          Location: `/api/v1/configurations/${saved.configurationId}`,
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json(toErrorBody(err), { status: err.status });
    throw err;
  }
}
