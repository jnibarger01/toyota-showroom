import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "../app/api/v1/configurations/[configurationId]/route";
import {
  InMemoryConfigurationRepository,
  setConfigurationRepository,
} from "../lib/server/configurationRepository";
import { validateCreateConfiguration } from "../lib/validation/configuration";

/**
 * Exercises the real PATCH handler, not a stand-in for it.
 *
 * `tests/components/configurationTransportConformance.test.tsx` asserts that both persistence
 * implementations agree, including that ownership is checked before a patch is validated. But it
 * reaches the server implementation through an adapter that *mirrors* the route rather than being
 * it, so on its own it would keep passing if the route reordered those steps and the adapter did
 * not. This file closes that gap by driving the handler itself.
 *
 * Route handlers turn out to be plain functions over Web `Request`/`Response`, so they need no Next
 * server to call — which makes this cheap enough that there is no excuse for the indirection.
 */

const repository = new InMemoryConfigurationRepository();
setConfigurationRepository(repository);

const CONFIGURATION_INPUT = {
  vehicleId: "4runner",
  modelYear: 2024,
  gradeId: "trd-pro",
  selections: { paint: ["paint-218-blueprint"] },
};

function patchRequest(configurationId: string, body: unknown, ownerToken?: string): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ownerToken !== undefined) headers["X-Owner-Token"] = ownerToken;

  return new NextRequest(`https://example.test/api/v1/configurations/${configurationId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

/** Invokes the handler the way the router does, with `params` as a promise. */
function callPatch(configurationId: string, body: unknown, ownerToken?: string) {
  return PATCH(patchRequest(configurationId, body, ownerToken), {
    params: Promise.resolve({ configurationId }),
  });
}

beforeEach(() => repository.clear());

describe("PATCH /api/v1/configurations/:id — check ordering", () => {
  it("rejects an unauthorized caller before validating the patch", async () => {
    // The regression this pins: the handler used to validate first, so a caller without the token
    // got 422 for an unknown option id and 403 for a known one — telling them which option ids are
    // real, and doing validation work on their behalf. It also disagreed with the browser-side
    // transport, which has always checked ownership first, leaving clients with no single contract.
    const { configuration } = await repository.create(validateCreateConfiguration(CONFIGURATION_INPUT));

    const response = await callPatch(
      configuration.configurationId,
      { selections: { paint: ["paint-does-not-exist"] } },
      "not-the-owner-token",
    );

    expect(response.status).toBe(403);
  });

  it("returns 403 identically for valid and invalid patches from a non-owner", async () => {
    // The property that actually matters: a non-owner's response must not vary with the body, or
    // the status code becomes an oracle for what is in the catalog.
    const { configuration } = await repository.create(validateCreateConfiguration(CONFIGURATION_INPUT));

    const [valid, invalid] = await Promise.all([
      callPatch(configuration.configurationId, { selections: { paint: ["paint-070-midnight-black"] } }, "wrong"),
      callPatch(configuration.configurationId, { selections: { paint: ["nope"] } }, "wrong"),
    ]);

    expect(valid.status).toBe(403);
    expect(invalid.status).toBe(403);
  });

  it("returns 404 for an unknown id even when the token is also wrong", async () => {
    // Existence is checked before ownership, so a 403 never implies an id exists.
    const response = await callPatch("cfg_definitely_not_real", { selections: {} }, "wrong");
    expect(response.status).toBe(404);
  });

  it("still applies a valid patch for the owner", async () => {
    // The reordering must not have broken the path everything actually uses.
    const { configuration, ownerToken } = await repository.create(
      validateCreateConfiguration(CONFIGURATION_INPUT),
    );

    const response = await callPatch(
      configuration.configurationId,
      { selections: { paint: ["paint-070-midnight-black"] } },
      ownerToken,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { revision: number; selections: Record<string, string[]> } };
    expect(body.data.revision).toBe(2);
    expect(body.data.selections.paint).toEqual(["paint-070-midnight-black"]);
  });

  it("still rejects an invalid patch from the owner", async () => {
    const { configuration, ownerToken } = await repository.create(
      validateCreateConfiguration(CONFIGURATION_INPUT),
    );

    const response = await callPatch(
      configuration.configurationId,
      { selections: { paint: ["paint-does-not-exist"] } },
      ownerToken,
    );

    expect(response.status).toBe(422);
  });
});
