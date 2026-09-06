import { beforeEach, describe, expect, it } from "vitest";
import {
  describeConfigurationTransport,
  type TransportAdapter,
} from "../conformance/configurationTransport";
import { InMemoryConfigurationRepository } from "../../lib/server/configurationRepository";
import { localConfigurationTransport } from "../../lib/api/localConfigurationTransport";
import { notFound } from "../../lib/api/errors";
import {
  validateCreateConfiguration,
  validatePatchConfiguration,
} from "../../lib/validation/configuration";

/**
 * Runs the shared conformance suite (`tests/conformance/configurationTransport.ts`) against both
 * persistence implementations, so a change to one that is not mirrored in the other fails here
 * rather than in whichever deployment target the author was not thinking about.
 *
 * Lives under `tests/components/` for one mechanical reason: `vitest.config.ts` maps that glob to
 * jsdom, and `localConfigurationTransport` needs a real `window.localStorage`. It is not a
 * component test. The `.tsx` extension is likewise only there to satisfy that glob.
 */

/**
 * Server side.
 *
 * The repository takes *pre-validated* input, because in production the route handler validates
 * before calling it. Validation therefore happens in the adapter, exactly where the route does it,
 * so the suite exercises the same path a real request takes rather than a shortcut around it.
 */
function serverAdapter(): TransportAdapter {
  const repository = new InMemoryConfigurationRepository();

  return {
    name: "server ConfigurationRepository",
    async reset() {
      repository.clear();
    },
    async create(input) {
      return repository.create(validateCreateConfiguration(input));
    },
    async get(configurationId) {
      const configuration = await repository.get(configurationId);
      // The repository returns null and lets the route produce the 404. The local transport throws
      // directly. Normalising here keeps that difference from leaking into the shared assertions —
      // and keeps it from being "fixed" in production code purely to suit a test.
      if (!configuration) throw notFound(`No configuration found with id "${configurationId}".`);
      return configuration;
    },
    async update(configurationId, patch, ownerToken) {
      // Mirrors app/api/v1/configurations/[configurationId]/route.ts exactly: existence, then
      // ownership, then validation. Ordering is part of the contract being tested, so an adapter
      // that reordered these would be testing a path production never takes.
      const existing = await repository.get(configurationId);
      if (!existing) throw notFound(`No configuration found with id "${configurationId}".`);
      await repository.requireOwner(configurationId, ownerToken);
      const validated = validatePatchConfiguration(patch, {
        vehicleId: existing.vehicleId,
        gradeId: existing.gradeId,
      });
      return repository.update(configurationId, validated, ownerToken);
    },
    async delete(configurationId, ownerToken) {
      await repository.delete(configurationId, ownerToken);
    },
  };
}

/** Browser side. Validates internally, so the adapter is close to a pass-through. */
function localAdapter(): TransportAdapter {
  return {
    name: "browser localConfigurationTransport",
    async reset() {
      window.localStorage.clear();
    },
    create: (input) => localConfigurationTransport.create(input),
    get: (configurationId) => localConfigurationTransport.get(configurationId),
    update: (configurationId, patch, ownerToken) =>
      localConfigurationTransport.update(configurationId, patch, ownerToken),
    delete: (configurationId, ownerToken) =>
      localConfigurationTransport.delete(configurationId, ownerToken),
  };
}

describe("configuration transport conformance", () => {
  describeConfigurationTransport(serverAdapter);
  describeConfigurationTransport(localAdapter);
});

/**
 * Guards the suite itself against silently covering less than it claims.
 *
 * A conformance suite that stops running against one of its implementations still passes, which is
 * the one failure mode it cannot detect about itself.
 */
describe("conformance coverage", () => {
  beforeEach(() => window.localStorage.clear());

  it("exercises both implementations, not one twice", async () => {
    // Distinct backing stores: a record created through one must not be visible through the other.
    const server = serverAdapter();
    const local = localAdapter();

    const { configuration } = await server.create({
      vehicleId: "4runner",
      modelYear: 2024,
      gradeId: "trd-pro",
      selections: {},
    });

    await expect(local.get(configuration.configurationId)).rejects.toThrow();
  });
});
