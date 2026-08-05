import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { D1ConfigurationRepository } from "../lib/server/d1ConfigurationRepository";
import { validateCreateConfiguration, validatePatchConfiguration } from "../lib/validation/configuration";

/**
 * Runs `D1ConfigurationRepository` against a *real* local D1 instance — Miniflare's SQLite-backed
 * emulation, reached via `wrangler`'s own `getPlatformProxy()` reading `wrangler.jsonc`. This needs
 * no Cloudflare account or network access (verified: `wrangler d1 migrations apply --local` and this
 * proxy both work fully offline), so it runs the actual drizzle-orm/d1 query builder and D1's actual
 * batch semantics rather than a hand-rolled stand-in that could silently drift from what production
 * does. This is the only test file in the suite that touches disk state outside the repo — Miniflare
 * persists to `.wrangler/state/` (gitignored), so schema setup below is idempotent rather than
 * assuming a clean slate, and every test creates its own fresh configuration rather than asserting
 * on total row counts, so leftover rows from a previous run can't make a test flaky.
 */

interface Env {
  DB: import("@cloudflare/workers-types").D1Database;
}

let proxy: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
let repo: D1ConfigurationRepository;

function migrationSqlFiles(): string[] {
  const dir = path.resolve(import.meta.dirname, "../db/migrations");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => path.join(dir, name));
}

beforeAll(async () => {
  proxy = await getPlatformProxy<Env>({ configPath: path.resolve(import.meta.dirname, "../wrangler.jsonc") });
  const db = proxy.env.DB;

  // Idempotent schema setup: `.wrangler/state/` persists across test runs, so re-running the
  // drizzle-generated SQL verbatim (plain `CREATE TABLE`, no `IF NOT EXISTS`) would fail on a
  // second run. The shipped migration file itself stays exactly what `wrangler d1 migrations
  // apply` runs in production; only this local exec is relaxed to tolerate re-application.
  //
  // `D1Database.exec()` splits its input on newlines, not semicolons — unlike a typical multi-
  // statement SQL script, each statement here must land on one line. drizzle-kit's own chunk
  // separator (`--> statement-breakpoint`) already marks where one statement ends and the next
  // begins, so each chunk is collapsed to a single line before being rejoined with real newlines.
  for (const file of migrationSqlFiles()) {
    const statements = readFileSync(file, "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .map((statement) =>
        statement
          .replace(/^CREATE TABLE `/, "CREATE TABLE IF NOT EXISTS `")
          .replace(/^CREATE UNIQUE INDEX `/, "CREATE UNIQUE INDEX IF NOT EXISTS `")
          .replace(/^CREATE INDEX `/, "CREATE INDEX IF NOT EXISTS `"),
      );
    await db.exec(statements.join("\n"));
  }

  repo = new D1ConfigurationRepository(db);
});

afterAll(async () => {
  await proxy?.dispose();
});

const baseInput = () =>
  validateCreateConfiguration({
    vehicleId: "4runner",
    modelYear: 2024,
    gradeId: "trd-pro",
    selections: { paint: ["paint-218-blueprint"] },
  });

describe("create", () => {
  it("persists a configuration retrievable by its own id, with a working owner token", async () => {
    const { configuration, ownerToken } = await repo.create(baseInput());

    expect(configuration.configurationId).toMatch(/^cfg_/);
    expect(configuration.vehicleId).toBe("4runner");
    expect(configuration.model).toBe("4Runner");
    expect(configuration.revision).toBe(1);
    expect(configuration.createdAt).toBe(configuration.updatedAt);
    expect(ownerToken.length).toBeGreaterThan(20);

    const fetched = await repo.get(configuration.configurationId);
    expect(fetched).toEqual(configuration);
  });

  it("mints distinct ids and tokens across two creates", async () => {
    const a = await repo.create(baseInput());
    const b = await repo.create(baseInput());
    expect(a.configuration.configurationId).not.toBe(b.configuration.configurationId);
    expect(a.ownerToken).not.toBe(b.ownerToken);
  });

  it("round-trips a null cameraState as undefined, not null", async () => {
    const { configuration } = await repo.create(baseInput());
    expect(configuration.cameraState).toBeUndefined();
  });

  it("round-trips a real cameraState", async () => {
    const { configuration } = await repo.create(
      validateCreateConfiguration({
        vehicleId: "4runner",
        modelYear: 2024,
        gradeId: "trd-pro",
        cameraState: { presetId: "hero", position: [7.5, 4, 8.5], target: [0, 1.1, 0] },
      }),
    );
    expect(configuration.cameraState).toEqual({ presetId: "hero", position: [7.5, 4, 8.5], target: [0, 1.1, 0] });
  });
});

describe("update", () => {
  it("bumps the revision, writes a revision-history row, and leaves createdAt untouched", async () => {
    const { configuration: saved, ownerToken } = await repo.create(baseInput());
    const patch = validatePatchConfiguration(
      { selections: { paint: ["paint-3u5-barcelona-red"] } },
      { vehicleId: saved.vehicleId, gradeId: saved.gradeId },
    );

    const updated = await repo.update(saved.configurationId, patch, ownerToken);

    expect(updated.revision).toBe(2);
    expect(updated.selections.paint).toEqual(["paint-3u5-barcelona-red"]);
    expect(updated.createdAt).toBe(saved.createdAt);
    expect(updated.updatedAt).not.toBe(saved.updatedAt);

    const history = await repo.listRevisions(saved.configurationId);
    expect(history.map((entry) => entry.revision)).toEqual([1, 2]);
    expect(history[0].selections.paint).toEqual(["paint-218-blueprint"]);
    expect(history[1].selections.paint).toEqual(["paint-3u5-barcelona-red"]);
    // Every reconstructed snapshot shares the original creation time...
    expect(history[0].createdAt).toBe(saved.createdAt);
    expect(history[1].createdAt).toBe(saved.createdAt);
    // ...but each has its own updatedAt, matching when that revision was written.
    expect(history[1].updatedAt).toBe(updated.updatedAt);
  });

  it("rejects a stale expectedRevision with 409, and the row is unchanged", async () => {
    const { configuration: saved, ownerToken } = await repo.create(baseInput());
    await repo.update(saved.configurationId, { selections: { paint: ["paint-1j9-ice-cap"] } }, ownerToken);

    await expect(
      repo.update(
        saved.configurationId,
        { selections: { paint: ["paint-070-midnight-black"] }, expectedRevision: 1 },
        ownerToken,
      ),
    ).rejects.toMatchObject({ status: 409, code: "revision_conflict" });

    expect((await repo.get(saved.configurationId))?.selections.paint).toEqual(["paint-1j9-ice-cap"]);
  });

  it("throws 404 for an unknown id", async () => {
    await expect(repo.update("cfg_does_not_exist", {}, "any-token")).rejects.toMatchObject({ status: 404 });
  });
});

describe("ownership", () => {
  it("rejects a PATCH with no or the wrong token, and the row is unchanged", async () => {
    const { configuration: saved } = await repo.create(baseInput());

    await expect(
      repo.update(saved.configurationId, { selections: { paint: ["paint-1j9-ice-cap"] } }, ""),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(
      repo.update(saved.configurationId, { selections: { paint: ["paint-1j9-ice-cap"] } }, "wrong-token"),
    ).rejects.toMatchObject({ status: 403 });

    expect((await repo.get(saved.configurationId))?.revision).toBe(1);
  });

  it("rejects a DELETE with the wrong token, without deleting the row", async () => {
    const { configuration: saved } = await repo.create(baseInput());

    await expect(repo.delete(saved.configurationId, "wrong-token")).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
    expect(await repo.get(saved.configurationId)).not.toBeNull();
  });

  it("accepts a write with the correct token", async () => {
    const { configuration: saved, ownerToken } = await repo.create(baseInput());
    await expect(
      repo.update(saved.configurationId, { selections: { paint: ["paint-1j9-ice-cap"] } }, ownerToken),
    ).resolves.toMatchObject({ revision: 2 });
  });
});

describe("delete", () => {
  it("removes the configuration and its revision history", async () => {
    const { configuration: saved, ownerToken } = await repo.create(baseInput());
    await repo.update(saved.configurationId, { selections: { paint: ["paint-1j9-ice-cap"] } }, ownerToken);

    expect(await repo.delete(saved.configurationId, ownerToken)).toBe(true);
    expect(await repo.get(saved.configurationId)).toBeNull();
    expect(await repo.listRevisions(saved.configurationId)).toEqual([]);
  });

  it("reports false for an unknown id", async () => {
    expect(await repo.delete("cfg_does_not_exist", "any-token")).toBe(false);
  });
});

describe("listRevisions", () => {
  it("returns an empty array for a configuration with no history table entries yet deleted", async () => {
    expect(await repo.listRevisions("cfg_never_existed")).toEqual([]);
  });
});
