import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api/errors";
import {
  createConfiguration,
  getConfiguration,
  listVehicleOptions,
  resetTransportDetection,
  updateConfiguration,
} from "../lib/api/configurations";
import { fourRunnerOptions } from "../lib/data/options/4runner";

/** Minimal `window.localStorage` so the local transport can run under the node test environment. */
function installLocalStorage(): void {
  const data = new Map<string, string>();
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const validCreate = { vehicleId: "4runner", modelYear: 2024, gradeId: "trd-pro" };

beforeEach(() => {
  installLocalStorage();
  resetTransportDetection();
  vi.restoreAllMocks();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe("catalog reads", () => {
  it("reads options from the generated static snapshot", async () => {
    const fetchMock = vi.fn(async (_url: string) => jsonResponse({ data: fourRunnerOptions }));
    vi.stubGlobal("fetch", fetchMock);

    const options = await listVehicleOptions("4runner");

    expect(fetchMock.mock.calls[0]?.[0]).toContain("/catalog/v1/vehicles/4runner/options.json");
    expect(options).toHaveLength(fourRunnerOptions.length);
  });

  it("filters by grade client-side, since a static host cannot vary on a query string", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: fourRunnerOptions })));

    const sr5 = await listVehicleOptions("4runner", "sr5");
    const trdPro = await listVehicleOptions("4runner", "trd-pro");

    expect(sr5.map((o) => o.id)).not.toContain("paint-0r2-solar-octane");
    expect(trdPro.map((o) => o.id)).toContain("paint-0r2-solar-octane");
  });
});

describe("backend detection", () => {
  it("uses the REST API when it answers", async () => {
    const remote = {
      configurationId: "cfg_remote",
      vehicleId: "4runner",
      modelYear: 2024,
      model: "4Runner",
      gradeId: "trd-pro",
      selections: {},
      revision: 1,
      schemaVersion: "1.0.0",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: remote }, 201)));

    const created = await createConfiguration(validCreate);
    expect(created.configurationId).toBe("cfg_remote");
  });

  it("falls back to the local transport when a write 404s, as on a static host", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 404)));

    const created = await createConfiguration(validCreate);

    expect(created.configurationId).toMatch(/^cfg_/);
    expect(created.model).toBe("4Runner");
    expect(created.revision).toBe(1);
  });

  it("falls back when fetch itself rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));

    const created = await createConfiguration(validCreate);
    expect(created.configurationId).toMatch(/^cfg_/);
  });

  it("latches the decision, so it does not retry the missing backend on every call", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 405));
    vi.stubGlobal("fetch", fetchMock);

    await createConfiguration(validCreate);
    const callsAfterFirst = fetchMock.mock.calls.length;
    await createConfiguration(validCreate);
    await createConfiguration(validCreate);

    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it("treats a GET 404 as a genuine not-found rather than a missing backend", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { code: "not_found", status: 404, message: "nope" } }, 404)));

    await expect(getConfiguration("cfg_missing")).rejects.toBeInstanceOf(ApiError);
    await expect(getConfiguration("cfg_missing")).rejects.toMatchObject({ status: 404 });
  });
});

describe("local transport behaviour", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 404)));
  });

  it("round-trips a configuration across reads", async () => {
    const created = await createConfiguration(validCreate);
    const fetched = await getConfiguration(created.configurationId);
    expect(fetched).toEqual(created);
  });

  it("bumps the revision on update", async () => {
    const created = await createConfiguration(validCreate);
    const updated = await updateConfiguration(created.configurationId, {
      selections: { paint: ["paint-218-blueprint"] },
    });

    expect(updated.revision).toBe(2);
    expect(updated.selections.paint).toEqual(["paint-218-blueprint"]);
  });

  it("enforces the same validation rules the server does", async () => {
    const created = await createConfiguration({ ...validCreate, gradeId: "sr5" });

    // Solar Octane is TRD Pro-only; the local transport rejects it exactly as the API would.
    await expect(
      updateConfiguration(created.configurationId, { selections: { paint: ["paint-0r2-solar-octane"] } }),
    ).rejects.toMatchObject({ status: 422 });

    await expect(
      updateConfiguration(created.configurationId, { selections: { paint: ["paint-not-real"] } }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("rejects a stale revision", async () => {
    const created = await createConfiguration(validCreate);
    await updateConfiguration(created.configurationId, { selections: { paint: ["paint-218-blueprint"] } });

    await expect(
      updateConfiguration(created.configurationId, {
        selections: { paint: ["paint-1j9-ice-cap"] },
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
