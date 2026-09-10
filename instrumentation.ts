// `declare module "cloudflare:workers"` (needed for the dynamic import below) lives in the
// package's dated/"latest" subpath, not its package-root `index.d.ts` (an older, purely global-
// ambient style with no such declaration) — and ambient declaration files need the standard
// triple-slash reference to be pulled in, not a regular `import`, which TypeScript can erase
// entirely when nothing is actually bound from it.
/// <reference types="@cloudflare/workers-types/latest" />

/**
 * Next.js/vinext instrumentation hook. Vinext emits `register()` into the generated Worker entry,
 * so it runs once per isolate in the same environment that serves requests. That makes this the
 * single authoritative place to bind D1-backed repositories once `wrangler.jsonc`'s DB binding is
 * available.
 *
 * Under Node dev/Vitest, `cloudflare:workers` does not exist. Configuration persistence keeps its
 * existing explicit in-memory/local-demo behavior there; lead persistence does not: its ambient
 * repository is fail-closed until D1 is installed because customer PII must never be accepted into
 * ephemeral memory and reported as durable success.
 */
export async function register(): Promise<void> {
  let cloudflareEnv: { DB?: unknown } | undefined;
  try {
    ({ env: cloudflareEnv } = await import("cloudflare:workers"));
  } catch {
    return; // Not running inside a Cloudflare Worker.
  }

  const db = cloudflareEnv?.DB;
  if (!db) return; // LeadRepository remains fail-closed; configuration behavior remains unchanged.

  const [
    { D1ConfigurationRepository },
    { setConfigurationRepository },
    { D1LeadRepository },
    { setLeadRepository },
  ] = await Promise.all([
    import("./lib/server/d1ConfigurationRepository"),
    import("./lib/server/configurationRepository"),
    import("./lib/server/d1LeadRepository"),
    import("./lib/server/leadRepository"),
  ]);

  const d1 = db as ConstructorParameters<typeof D1ConfigurationRepository>[0];
  setConfigurationRepository(new D1ConfigurationRepository(d1));
  setLeadRepository(new D1LeadRepository(d1));
}
