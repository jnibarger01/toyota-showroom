import { NextRequest, NextResponse } from "next/server";
import { invalidBody } from "../../../../lib/api/errors";
import { getConfigurationRepository } from "../../../../lib/server/configurationRepository";
import { priceSelections, validateCreateConfiguration } from "../../../../lib/validation/configuration";
import { CUSTOMIZATION_SCHEMA_VERSION } from "../../../../lib/types/customization";
import { enforceConfigWriteRateLimit } from "../../../../lib/server/rateLimit";
import { withRouteTelemetry } from "../../../../lib/server/apiResponse";
import { withSecurityHeaders } from "../../../../lib/server/securityHeaders";

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

/**
 * POST /api/v1/configurations — create a configuration and return the canonical saved record.
 *
 * `ownerToken` in the response is the only time the plaintext capability token is ever sent — the
 * server stores only its hash (lib/shared/ownerToken.ts). The caller must hold onto it and present
 * it via the `X-Owner-Token` header on every future PATCH/DELETE to this configuration; it is not
 * required for GET, which stays open so a shared configuration link keeps working unauthenticated.
 */
export const POST = withRouteTelemetry(
  "/api/v1/configurations",
  "POST",
  async (request: NextRequest) => {
      await enforceConfigWriteRateLimit(request);
      const input = validateCreateConfiguration(await readJson(request));
      const { configuration, ownerToken } = await getConfigurationRepository().create(input);

      return NextResponse.json(
        {
          schemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
          data: configuration,
          ownerToken,
          pricing: { optionsTotal: priceSelections(configuration.vehicleId, configuration.selections) },
        },
        {
          status: 201,
          headers: withSecurityHeaders({
            Location: `/api/v1/configurations/${configuration.configurationId}`,
            "Cache-Control": "no-store",
          }),
        },
      );
  },
);
