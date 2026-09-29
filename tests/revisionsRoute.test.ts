import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as LIST_REVISIONS, POST as RESTORE_REVISION } from "../app/api/v1/configurations/[configurationId]/revisions/route";
import { PATCH } from "../app/api/v1/configurations/[configurationId]/route";
import {
  InMemoryConfigurationRepository,
  setConfigurationRepository,
} from "../lib/server/configurationRepository";
import { validateCreateConfiguration, validatePatchConfiguration } from "../lib/validation/configuration";

/**
 * Drives the real revision-history route handlers (issue #32), the same way
 * `tests/configurationRouteOrdering.test.ts` drives PATCH: plain functions over Web
 * `Request`/`Response`, no Next server needed. Restore's key invariant — the append-only history
 * is never rewritten — is asserted against the repository the handlers actually use.
 */

const repository = new InMemoryConfigurationRepository();
setConfigurationRepository(repository);

const CONFIGURATION_INPUT = {
  vehicleId: "4runner",
  modelYear: 2024,
  gradeId: "trd-pro",
  selections: { paint: ["paint-218-blueprint"] },
};

beforeEach(() => repository.clear());

async function createSaved() {
  return repository.create(validateCreateConfiguration(CONFIGURATION_INPUT));
}

function revisionsRequest(
  configurationId: string,
  method: "GET" | "POST",
  ownerToken?: string,
  body?: unknown,
): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ownerToken !== undefined) headers["X-Owner-Token"] = ownerToken;

  return new NextRequest(`https://example.test/api/v1/configurations/${configurationId}/revisions`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function callList(configurationId: string, ownerToken?: string) {
  return LIST_REVISIONS(revisionsRequest(configurationId, "GET", ownerToken), {
    params: Promise.resolve({ configurationId }),
  });
}

function callRestore(configurationId: string, ownerToken?: string, body?: unknown) {
  return RESTORE_REVISION(revisionsRequest(configurationId, "POST", ownerToken, body ?? {}), {
    params: Promise.resolve({ configurationId }),
  });
}

describe("GET /configurations/:id/revisions", () => {
  it("requires the owner token", async () => {
    const { configuration } = await createSaved();

    const noToken = await callList(configuration.configurationId);
    expect(noToken.status).toBe(403);

    const wrongToken = await callList(configuration.configurationId, "rev_wrong_token");
    expect(wrongToken.status).toBe(403);
  });

  it("reports 404 for an unknown configuration even with a token", async () => {
    expect((await callList("cfg_never_existed", "rev_some_token")).status).toBe(404);
  });

  it("returns the full append-only history, oldest first", async () => {
    const { configuration, ownerToken } = await createSaved();

    await repository.update(
      configuration.configurationId,
      { selections: { paint: ["paint-1j9-ice-cap"] } },
      ownerToken,
    );

    const response = await callList(configuration.configurationId, ownerToken);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const body = (await response.json()) as {
      data: Array<{ revision: number; selections: Record<string, string[]> }>;
    };
    expect(body.data.map((entry) => entry.revision)).toEqual([1, 2]);
    expect(body.data[0].selections).toEqual({ paint: ["paint-218-blueprint"] });
    expect(body.data[1].selections).toEqual({ paint: ["paint-1j9-ice-cap"] });
  });

  it("includes trusted package pricing on each revision", async () => {
    const { configuration, ownerToken } = await repository.create(validateCreateConfiguration({
      vehicleId: "4runner", modelYear: 2024, gradeId: "trd-off-road", factoryPackageIds: ["premium-pkg"],
    }));
    await repository.update(configuration.configurationId, { factoryPackageIds: [] }, ownerToken);

    const response = await callList(configuration.configurationId, ownerToken);
    const body = await response.json() as {
      data: Array<{ revision: number; factoryPackageIds?: string[]; pricing: { factoryPackagesTotal: number } }>;
    };
    expect(body.data.map(({ pricing }) => pricing.factoryPackagesTotal)).toEqual([3_520, 0]);
    expect(body.data[0].factoryPackageIds).toEqual(["premium-pkg"]);
  });
});

describe("POST /configurations/:id/revisions (restore)", () => {
  it("restores factory package choices from the selected revision", async () => {
    const { configuration, ownerToken } = await repository.create(validateCreateConfiguration({
      vehicleId: "4runner", modelYear: 2024, gradeId: "trd-off-road", factoryPackageIds: ["premium-pkg"],
    }));
    await repository.update(configuration.configurationId, validatePatchConfiguration({ factoryPackageIds: [] }, {
      vehicleId: configuration.vehicleId, gradeId: configuration.gradeId,
    }), ownerToken);
    const response = await callRestore(configuration.configurationId, ownerToken, { revision: 1 });
    const { data, pricing } = await response.json() as {
      data: { factoryPackageIds: string[] };
      pricing: { factoryPackagesTotal: number };
    };
    expect(data.factoryPackageIds).toEqual(["premium-pkg"]);
    expect(pricing.factoryPackagesTotal).toBe(3_520);
  });

  it("requires the owner token and does not leak existence", async () => {
    const { configuration } = await createSaved();

    expect((await callRestore(configuration.configurationId)).status).toBe(403);
    expect((await callRestore(configuration.configurationId, "rev_wrong_token")).status).toBe(403);
    expect((await callRestore("cfg_never_existed", "rev_some_token")).status).toBe(404);
  });

  it("rejects a malformed or non-positive target revision", async () => {
    const { configuration, ownerToken } = await createSaved();

    for (const body of [{}, { revision: 0 }, { revision: 1.5 }, { revision: "1" }]) {
      const response = await callRestore(configuration.configurationId, ownerToken, body);
      expect(response.status).toBe(422);
    }
  });

  it("reports 404 for a revision the configuration never had", async () => {
    const { configuration, ownerToken } = await createSaved();
    const response = await callRestore(configuration.configurationId, ownerToken, { revision: 99 });
    expect(response.status).toBe(404);
  });

  it("restores an earlier revision as a NEW revision without rewriting history", async () => {
    const { configuration, ownerToken } = await createSaved();
    const id = configuration.configurationId;

    const { data: revision2 } = (await (
      await PATCH(
        new NextRequest(`https://example.test/api/v1/configurations/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-Owner-Token": ownerToken },
          body: JSON.stringify({ selections: { paint: ["paint-1j9-ice-cap"] } }),
        }),
        { params: Promise.resolve({ configurationId: id }) },
      )
    ).json()) as { data: { revision: number } };
    expect(revision2.revision).toBe(2);

    // Restore revision 1 (blueprint) while the build is on revision 2.
    const response = await callRestore(id, ownerToken, { revision: 1 });
    expect(response.status).toBe(200);

    const { data: restored, pricing } = (await response.json()) as {
      data: { revision: number; selections: Record<string, string[]> };
      pricing: { optionsTotal: number; factoryPackagesTotal: number };
    };
    expect(restored.revision).toBe(3);
    expect(restored.selections).toEqual({ paint: ["paint-218-blueprint"] });
    expect(pricing).toEqual({ optionsTotal: expect.any(Number), factoryPackagesTotal: 0 });

    // Immutable history: revisions 1 and 2 are untouched, revision 3 is the restore itself.
    const history = await repository.listRevisions(id);
    expect(history.map((entry) => entry.revision)).toEqual([1, 2, 3]);
    expect(history[1].selections).toEqual({ paint: ["paint-1j9-ice-cap"] });
  });

  it("treats restoring the current revision as a no-op, appending nothing", async () => {
    const { configuration, ownerToken } = await createSaved();
    const id = configuration.configurationId;

    const response = await callRestore(id, ownerToken, { revision: 1 });
    expect(response.status).toBe(200);

    const { data } = (await response.json()) as { data: { revision: number } };
    expect(data.revision).toBe(1);
    expect((await repository.listRevisions(id)).map((entry) => entry.revision)).toEqual([1]);
  });
});
