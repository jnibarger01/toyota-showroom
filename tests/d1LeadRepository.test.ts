import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { D1LeadRepository } from "../lib/server/d1LeadRepository";
import { validateCreateLead } from "../lib/validation/lead";

interface Env {
  DB: import("@cloudflare/workers-types").D1Database;
}

const MINIFLARE_STATE_DIR = path.resolve(import.meta.dirname, "../.wrangler/state/test-d1-leads");

let proxy: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
let repo: D1LeadRepository;

function migrationSqlFiles(): string[] {
  const dir = path.resolve(import.meta.dirname, "../db/migrations");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => path.join(dir, name));
}

beforeAll(async () => {
  proxy = await getPlatformProxy<Env>({
    configPath: path.resolve(import.meta.dirname, "../wrangler.jsonc"),
    persist: { path: MINIFLARE_STATE_DIR },
  });
  const db = proxy.env.DB;

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

    for (const statement of statements) {
      try {
        await db.exec(statement);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/duplicate column name/i.test(message)) continue;
        throw error;
      }
    }
  }

  repo = new D1LeadRepository(db);
});

afterAll(async () => {
  await proxy?.dispose();
});

function contact(idempotencyKey?: string) {
  return validateCreateLead({
    kind: "contact",
    name: "Jamie Customer",
    email: "JAMIE@example.com",
    message: "Please contact me about a Toyota.",
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
}

describe("D1LeadRepository", () => {
  it("persists a canonical lead without returning internal idempotency data", async () => {
    const result = await repo.create(contact(`d1-${crypto.randomUUID()}`));

    expect(result.created).toBe(true);
    expect(result.lead.id).toMatch(/^lead_/);
    expect(result.lead.email).toBe("jamie@example.com");
    expect(result.lead).not.toHaveProperty("idempotencyKey");
    expect(Number.isNaN(Date.parse(result.lead.createdAt))).toBe(false);
  });

  it("returns the first accepted record on an idempotent replay", async () => {
    const key = `d1-replay-${crypto.randomUUID()}`;
    const first = await repo.create(contact(key));
    const replay = await repo.create(
      validateCreateLead({
        kind: "contact",
        name: "Changed Name",
        email: "changed@example.com",
        message: "Changed content must not overwrite the accepted request.",
        idempotencyKey: key,
      }),
    );

    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.lead).toEqual(first.lead);
  });

  it("allows exactly one create when identical idempotency keys race", async () => {
    const key = `d1-race-${crypto.randomUUID()}`;
    const results = await Promise.all([repo.create(contact(key)), repo.create(contact(key))]);

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results[0].lead.id).toBe(results[1].lead.id);
  });

  it("creates distinct records when no idempotency key is supplied", async () => {
    const [first, second] = await Promise.all([repo.create(contact()), repo.create(contact())]);
    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(first.lead.id).not.toBe(second.lead.id);
  });
});
