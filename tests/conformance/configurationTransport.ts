import { describe, expect, it, beforeEach } from "vitest";
import { ApiError } from "../../lib/api/errors";
import { CUSTOMIZATION_SCHEMA_VERSION, type VehicleConfiguration } from "../../lib/types/customization";

/**
 * One conformance suite, run against both configuration persistence implementations.
 *
 * This app has two, and they are not layered — they are peers, chosen at runtime by whether the
 * deployment has a request-aware server:
 *
 *   - `ConfigurationRepository` (`lib/server/*`), behind the Cloudflare Worker's REST routes.
 *   - `localConfigurationTransport` (`lib/api/localConfigurationTransport.ts`), which the client
 *     falls back to on the GitHub Pages static export, where those routes do not exist.
 *
 * Both were tested, but separately — `tests/persistence.test.ts` for one, `tests/transport.test.ts`
 * for the other — with no shared assertion that they *agree*. That is the dangerous shape: a
 * validator change, a revision-bump tweak, or a different owner-token check lands in one and not
 * the other, and the divergence is invisible until a user hits the deployment that has the old
 * behaviour. Worse, the failure is silent and data-shaped rather than an error, because both
 * implementations keep working — just differently.
 *
 * ## Why an adapter rather than a common interface
 *
 * The two have deliberately different signatures, and unifying them in production code would mean
 * changing working code to suit a test. `get` is the clearest case: the repository returns `null`
 * for a missing id and lets the route translate that into a 404, while the local transport has no
 * route beneath it and throws `notFound` directly. Both are right for their context.
 *
 * So the adapter lives here, in the test layer, and normalises exactly those differences. What it
 * must *not* absorb is behaviour: everything below the adapter — revision semantics, owner-token
 * enforcement, validation, conflict detection — is asserted identically on both.
 */
export interface TransportAdapter {
  name: string;
  /** Fresh, empty backing store. */
  reset(): Promise<void>;
  create(input: unknown): Promise<{ configuration: VehicleConfiguration; ownerToken: string }>;
  /** Normalised to "resolves or throws ApiError(404)" — see the note above about `null`. */
  get(configurationId: string): Promise<VehicleConfiguration>;
  update(configurationId: string, patch: unknown, ownerToken: string): Promise<VehicleConfiguration>;
  delete(configurationId: string, ownerToken: string): Promise<void>;
}

const VALID_INPUT = {
  vehicleId: "4runner",
  modelYear: 2024,
  gradeId: "trd-pro",
  selections: { paint: ["paint-218-blueprint"] },
};

/** Asserts the thrown value is an `ApiError` carrying `status`, and returns it. */
async function expectApiError(operation: Promise<unknown>, status: number): Promise<ApiError> {
  try {
    await operation;
  } catch (error) {
    expect(error, `expected an ApiError, got ${String(error)}`).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
    return error as ApiError;
  }
  throw new Error(`expected the operation to reject with status ${status}, but it resolved`);
}

/**
 * Registers the shared suite for one implementation.
 *
 * Every assertion here is a behaviour a client depends on regardless of which deployment target it
 * happens to be talking to. If an assertion is only true of one implementation, it does not belong
 * in this file — it belongs in that implementation's own suite.
 */
export function describeConfigurationTransport(makeAdapter: () => TransportAdapter): void {
  const adapter = makeAdapter();

  describe(adapter.name, () => {
    beforeEach(() => adapter.reset());

    describe("create", () => {
      it("returns a canonical record at revision 1 with a plaintext owner token", async () => {
        const { configuration, ownerToken } = await adapter.create(VALID_INPUT);

        expect(configuration.configurationId).toMatch(/^cfg_/);
        expect(configuration.vehicleId).toBe("4runner");
        expect(configuration.gradeId).toBe("trd-pro");
        expect(configuration.revision).toBe(1);
        expect(configuration.schemaVersion).toBe(CUSTOMIZATION_SCHEMA_VERSION);
        expect(ownerToken).toBeTruthy();
        expect(typeof ownerToken).toBe("string");
      });

      it("resolves the display model from the vehicle id rather than trusting the client", async () => {
        // The client sends an id; the model name is derived server-side. A client that could set it
        // directly could make a saved configuration claim to be a vehicle it is not.
        const { configuration } = await adapter.create(VALID_INPUT);
        expect(configuration.model).toBe("4Runner");
      });

      it("issues a distinct id and owner token per configuration", async () => {
        const first = await adapter.create(VALID_INPUT);
        const second = await adapter.create(VALID_INPUT);

        expect(first.configuration.configurationId).not.toBe(second.configuration.configurationId);
        // A shared token would make every configuration editable by anyone who saved one.
        expect(first.ownerToken).not.toBe(second.ownerToken);
      });

      it("rejects an unknown vehicle id", async () => {
        // 404 rather than 422: an unknown vehicle id is a missing resource, not a malformed body.
        await expectApiError(adapter.create({ ...VALID_INPUT, vehicleId: "delorean" }), 404);
      });

      it("rejects an unknown grade for a known vehicle", async () => {
        await expectApiError(adapter.create({ ...VALID_INPUT, gradeId: "not-a-grade" }), 422);
      });

      it("rejects an option id that is not in the vehicle's catalog", async () => {
        await expectApiError(
          adapter.create({ ...VALID_INPUT, selections: { paint: ["paint-does-not-exist"] } }),
          422,
        );
      });

      it("rejects multiple selections in a single-select category", async () => {
        // A vehicle has one paint colour. Accepting two would produce a record whose 3D state is
        // undefined — whichever option happened to be applied last would win.
        await expectApiError(
          adapter.create({
            ...VALID_INPUT,
            selections: { paint: ["paint-218-blueprint", "paint-070-midnight-black"] },
          }),
          422,
        );
      });
    });

    describe("get", () => {
      it("returns a saved configuration without requiring the owner token", async () => {
        // Reads are deliberately unauthenticated: shared configuration links depend on it.
        const { configuration } = await adapter.create(VALID_INPUT);
        const fetched = await adapter.get(configuration.configurationId);
        expect(fetched.configurationId).toBe(configuration.configurationId);
        expect(fetched.selections).toEqual(configuration.selections);
      });

      it("reports a missing id as 404", async () => {
        await expectApiError(adapter.get("cfg_does_not_exist"), 404);
      });
    });

    describe("update", () => {
      it("bumps the revision and applies the patch", async () => {
        const { configuration, ownerToken } = await adapter.create(VALID_INPUT);
        const updated = await adapter.update(
          configuration.configurationId,
          { selections: { paint: ["paint-070-midnight-black"] } },
          ownerToken,
        );

        expect(updated.revision).toBe(2);
        expect(updated.selections.paint).toEqual(["paint-070-midnight-black"]);
      });

      it("rejects a write without the owner token", async () => {
        const { configuration } = await adapter.create(VALID_INPUT);
        await expectApiError(
          adapter.update(configuration.configurationId, { selections: {} }, "not-the-token"),
          403,
        );
      });

      it("leaves the record untouched when the owner token is wrong", async () => {
        // A rejected write that still mutated would be worse than one that succeeded.
        const { configuration } = await adapter.create(VALID_INPUT);
        await expectApiError(
          adapter.update(configuration.configurationId, { selections: { paint: ["paint-070-midnight-black"] } }, "wrong"),
          403,
        );

        const fetched = await adapter.get(configuration.configurationId);
        expect(fetched.revision).toBe(1);
        expect(fetched.selections.paint).toEqual(["paint-218-blueprint"]);
      });

      it("checks ownership before validating the patch", async () => {
        // Ordering, not just outcome. The two implementations disagreed here: the server route
        // validated first, so a caller without the token could tell a valid option id (422) from an
        // invalid one (403), while the browser transport rejected on the token first. Beyond the
        // small information leak, doing validation work for an unauthorized caller is the wrong
        // order — and a client that saw 422 from one deployment and 403 from the other for the
        // same request has no coherent contract to code against.
        const { configuration } = await adapter.create(VALID_INPUT);
        await expectApiError(
          adapter.update(
            configuration.configurationId,
            { selections: { paint: ["paint-does-not-exist"] } },
            "not-the-token",
          ),
          403,
        );
      });

      it("reports an unknown id as 404 even when the token is also wrong", async () => {
        // Existence is checked before ownership, so probing ids does not require a valid token to
        // get a coherent answer — and a 403 on a nonexistent id would imply it exists.
        await expectApiError(adapter.update("cfg_gone", { selections: {} }, "nope"), 404);
      });

      it("rejects a stale expectedRevision with 409", async () => {
        // Two tabs editing one configuration is the ordinary case this protects.
        const { configuration, ownerToken } = await adapter.create(VALID_INPUT);
        await adapter.update(configuration.configurationId, { selections: {} }, ownerToken);

        await expectApiError(
          adapter.update(
            configuration.configurationId,
            { selections: {}, expectedRevision: 1 },
            ownerToken,
          ),
          409,
        );
      });

      it("accepts a matching expectedRevision", async () => {
        const { configuration, ownerToken } = await adapter.create(VALID_INPUT);
        const updated = await adapter.update(
          configuration.configurationId,
          { selections: { paint: ["paint-070-midnight-black"] }, expectedRevision: 1 },
          ownerToken,
        );
        expect(updated.revision).toBe(2);
      });

      it("reports a missing id as 404", async () => {
        await expectApiError(adapter.update("cfg_gone", { selections: {} }, "token"), 404);
      });

      it("validates patched selections against the catalog", async () => {
        const { configuration, ownerToken } = await adapter.create(VALID_INPUT);
        await expectApiError(
          adapter.update(
            configuration.configurationId,
            { selections: { paint: ["paint-does-not-exist"] } },
            ownerToken,
          ),
          422,
        );
      });

      it("preserves immutable identity fields across a patch", async () => {
        // vehicleId/modelYear/gradeId are set at creation only. A patch that could change them
        // would let a saved record drift into describing a different vehicle entirely.
        const { configuration, ownerToken } = await adapter.create(VALID_INPUT);
        const updated = await adapter.update(
          configuration.configurationId,
          { selections: {}, vehicleId: "camry", gradeId: "le", modelYear: 1999 },
          ownerToken,
        );

        expect(updated.vehicleId).toBe("4runner");
        expect(updated.gradeId).toBe("trd-pro");
        expect(updated.modelYear).toBe(2024);
      });
    });

    describe("delete", () => {
      it("removes the configuration", async () => {
        const { configuration, ownerToken } = await adapter.create(VALID_INPUT);
        await adapter.delete(configuration.configurationId, ownerToken);
        await expectApiError(adapter.get(configuration.configurationId), 404);
      });

      it("rejects a delete without the owner token", async () => {
        const { configuration } = await adapter.create(VALID_INPUT);
        await expectApiError(adapter.delete(configuration.configurationId, "not-the-token"), 403);

        // Still there — a rejected delete must not be a successful one.
        const fetched = await adapter.get(configuration.configurationId);
        expect(fetched.configurationId).toBe(configuration.configurationId);
      });

      it("treats deleting an already-gone id as success", async () => {
        // Idempotent by design, so a retried delete after a dropped response is not an error.
        await expect(adapter.delete("cfg_never_existed", "token")).resolves.toBeUndefined();
      });
    });
  });
}
