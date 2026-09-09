import { NextRequest, NextResponse } from "next/server";
import { invalidBody, payloadTooLarge } from "../../../../lib/api/errors";
import { getLeadRepository } from "../../../../lib/server/leadRepository";
import { enforceLeadWriteRateLimit } from "../../../../lib/server/rateLimit";
import { withRouteTelemetry } from "../../../../lib/server/apiResponse";
import { withSecurityHeaders } from "../../../../lib/server/securityHeaders";
import { validateCreateLead } from "../../../../lib/validation/lead";

export const dynamic = "force-dynamic";

/**
 * Enough for the validated maximum fields plus JSON overhead, while keeping public PII intake
 * bounded well below a general-purpose upload endpoint. This limit is enforced on bytes, not JS
 * string length, before JSON parsing.
 */
const MAX_LEAD_BODY_BYTES = 16 * 1024;

async function readBoundedJson(request: NextRequest): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_LEAD_BODY_BYTES) {
      throw payloadTooLarge(`Lead request body must be at most ${MAX_LEAD_BODY_BYTES} bytes.`);
    }
  }

  const reader = request.body?.getReader();
  if (!reader) throw invalidBody("Request body must be a JSON object.");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_LEAD_BODY_BYTES) {
      await reader.cancel();
      throw payloadTooLarge(`Lead request body must be at most ${MAX_LEAD_BODY_BYTES} bytes.`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw invalidBody("Request body must contain valid JSON.");
  }
}

/**
 * POST /api/v1/leads
 *
 * Success is authoritative: this handler returns 2xx only after the configured repository returns
 * a stored lead. D1 failures and other unexpected persistence faults are deliberately re-thrown by
 * `withRouteTelemetry`, allowing the platform to surface a real 5xx instead of manufacturing a
 * customer-facing success response.
 */
export const POST = withRouteTelemetry(
  "/api/v1/leads",
  "POST",
  async (request: NextRequest) => {
    await enforceLeadWriteRateLimit(request);
    const input = validateCreateLead(await readBoundedJson(request));
    const { lead, created } = await getLeadRepository().create(input);

    return NextResponse.json(
      { data: lead },
      {
        status: created ? 201 : 200,
        headers: withSecurityHeaders({ "Cache-Control": "no-store" }),
      },
    );
  },
);
