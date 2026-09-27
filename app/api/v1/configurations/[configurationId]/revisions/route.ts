import { NextRequest, NextResponse } from "next/server";
import { invalidBody, notFound } from "../../../../../../lib/api/errors";
import { getConfigurationRepository } from "../../../../../../lib/server/configurationRepository";
import {
  CUSTOMIZATION_SCHEMA_VERSION,
  type VehicleConfiguration,
} from "../../../../../../lib/types/customization";
import { priceConfiguration, priceFactoryPackages } from "../../../../../../lib/validation/configuration";
import { enforceConfigWriteRateLimit } from "../../../../../../lib/server/rateLimit";
import { withRouteTelemetry } from "../../../../../../lib/server/apiResponse";
import { withSecurityHeaders } from "../../../../../../lib/server/securityHeaders";

export const dynamic = "force-dynamic";

/** Header the caller presents its capability token through — see lib/shared/ownerToken.ts. */
const OWNER_TOKEN_HEADER = "x-owner-token";

function ownerTokenFrom(request: NextRequest): string {
  return request.headers.get(OWNER_TOKEN_HEADER) ?? "";
}

function respondRecord(record: VehicleConfiguration, status = 200) {
  return NextResponse.json(
    {
      schemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
      data: record,
      pricing: {
        optionsTotal: priceConfiguration(record.vehicleId, record.selections, record.paintStudio),
        factoryPackagesTotal: priceFactoryPackages(record.vehicleId, record.gradeId, record.factoryPackageIds),
      },
    },
    { status, headers: withSecurityHeaders({ "Cache-Control": "no-store", ETag: `"${record.configurationId}-r${record.revision}"` }) },
  );
}

/**
 * History is owner-scoped (issue #32): a configuration id alone must not leak the full selection
 * history of someone else's build, so — unlike the plain GET above the tree — every read here
 * requires the `X-Owner-Token` header. Existence is checked before ownership so a wrong token on an
 * unknown id still reports 404, matching the PATCH/DELETE handlers' ordering.
 */
async function requireOwnedConfiguration(configurationId: string, ownerToken: string): Promise<void> {
  const repository = getConfigurationRepository();
  await repository.requireOwner(configurationId, ownerToken);
}

async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw invalidBody("Request body must be valid JSON.");
  }
}

/**
 * GET /api/v1/configurations/:configurationId/revisions — owner-gated full revision history for
 * one configuration, oldest first. Each entry carries the same shape (and pricing) as the plain
 * configuration GET, so the builder can render and diff snapshots without a second call.
 */
export const GET = withRouteTelemetry(
  "/api/v1/configurations/:id/revisions",
  "GET",
  async (request: NextRequest, { params }: { params: Promise<{ configurationId: string }> }) => {
    const { configurationId } = await params;
    await requireOwnedConfiguration(configurationId, ownerTokenFrom(request));

    const history = await getConfigurationRepository().listRevisions(configurationId);
    return NextResponse.json(
      {
        schemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
        data: history,
      },
      { status: 200, headers: withSecurityHeaders({ "Cache-Control": "no-store" }) },
    );
  },
);

/**
 * POST /api/v1/configurations/:configurationId/revisions — restore an earlier revision.
 *
 * Restore is a normal mutation, not a history rewrite: the target snapshot's selections (plus
 * camera and paint-studio state) are applied through the repository's ordinary `update`, so the
 * restored content lands as a brand-new revision appended on top of the append-only history.
 * `expectedRevision` is supplied from the just-read record, so a concurrent writer between the
 * read and the restore still fails closed with 409 instead of clobbering their change.
 *
 * Restoring the revision that is already current is a no-op that returns the record unchanged —
 * no duplicate revision row, no false conflict.
 */
export const POST = withRouteTelemetry(
  "/api/v1/configurations/:id/revisions",
  "POST",
  async (request: NextRequest, { params }: { params: Promise<{ configurationId: string }> }) => {
    const ownerToken = ownerTokenFrom(request);
    await enforceConfigWriteRateLimit(request, undefined, ownerToken);
    const { configurationId } = await params;

    const repository = getConfigurationRepository();
    const current = await repository.get(configurationId);
    if (!current) throw notFound(`No configuration found with id "${configurationId}".`);
    await repository.requireOwner(configurationId, ownerToken);

    const body = (await readJson(request)) as { revision?: unknown } | null;
    const targetRevision = body?.revision;
    if (!Number.isInteger(targetRevision) || (targetRevision as number) < 1) {
      throw invalidBody('"revision" must be a positive integer.');
    }

    const history = await repository.listRevisions(configurationId);
    const snapshot = history.find((entry) => entry.revision === targetRevision);
    if (!snapshot) {
      throw notFound(`Configuration "${configurationId}" has no revision ${targetRevision}.`);
    }

    if (snapshot.revision === current.revision) {
      return respondRecord(current);
    }

    // Existence and ownership were already verified above; `update` re-checks both, which keeps
    // every write — restore included — on the one audited mutation path (revision bump + history
    // append) rather than adding a second writer with its own rules.
    return respondRecord(
      await repository.update(
        configurationId,
        {
          selections: snapshot.selections,
          factoryPackageIds: snapshot.factoryPackageIds ?? [],
          cameraState: snapshot.cameraState,
          paintStudio: snapshot.paintStudio,
          expectedRevision: current.revision,
        },
        ownerToken,
      ),
    );
  },
);
