import { defineConfig } from "drizzle-kit";

/**
 * `driver: "d1-http"` is only used by drizzle-kit's own CLI commands (`db:generate` diffs the TS
 * schema locally and needs no credentials; `db:migrate`/`db:studio` talk to the real D1 instance over
 * Cloudflare's HTTP API and do). The Worker's own runtime binding (`env.DB`, configured in
 * wrangler.jsonc's `d1_databases`) is separate and does not go through this file at all.
 *
 * Required for `db:migrate`/`db:studio`: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID (the same
 * id as wrangler.jsonc's `database_id`), CLOUDFLARE_D1_TOKEN (a Cloudflare API token scoped to D1
 * edit). See docs/DEPLOYMENT.md for how to obtain each.
 */
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "sqlite",
  driver: "d1-http",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    databaseId: process.env.CLOUDFLARE_DATABASE_ID ?? "",
    token: process.env.CLOUDFLARE_D1_TOKEN ?? "",
  },
});
