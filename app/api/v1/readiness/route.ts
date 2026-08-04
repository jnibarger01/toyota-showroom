import { NextRequest, NextResponse } from "next/server";
import { serviceUnavailable, toErrorBody } from "../../../../lib/api/errors";
import { getD1Binding } from "../../../../lib/server/cloudflareEnv";
import { responseHeaders } from "../../../../lib/server/http";
import { log } from "../../../../lib/server/log";

export const dynamic = "force-dynamic";

/** GET /api/v1/readiness — verifies that the Worker can execute a D1 query. */
export async function GET(request: NextRequest) {
  const binding = await getD1Binding();
  if (!binding) {
    const error = serviceUnavailable("The D1 binding is not configured in this runtime.");
    return NextResponse.json(toErrorBody(error), {
      status: error.status,
      headers: responseHeaders(request),
    });
  }

  try {
    await binding.prepare("SELECT 1 AS ready").first();
    return NextResponse.json(
      { status: "ready", database: "d1", timestamp: new Date().toISOString() },
      { headers: responseHeaders(request) },
    );
  } catch (cause) {
    log("error", "readiness.d1_failed", request, {
      error: cause instanceof Error ? cause.message : String(cause),
    });
    const error = serviceUnavailable("The D1 binding is configured but did not answer the readiness query.");
    return NextResponse.json(toErrorBody(error), {
      status: error.status,
      headers: responseHeaders(request),
    });
  }
}
