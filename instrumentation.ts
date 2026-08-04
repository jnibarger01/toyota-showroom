// `declare module "cloudflare:workers"` (needed for the dynamic import below) lives in the
// package's dated/"latest" subpath, not its package-root `index.d.ts` (an older, purely global-
// ambient style with no such declaration) — and ambient declaration files need the standard
// triple-slash reference to be pulled in, not a regular `import`, which TypeScript can erase
// entirely when nothing is actually bound from it.
/// <reference types="@cloudflare/workers-types/latest" />

/**
 * Next.js/vinext instrumentation hook. For the App Router, vinext emits `register()` as a
 * top-level `await` inside the generated Worker entry, so it runs once per isolate, in the same
 * environment that serves requests — the correct place to bind the D1-backed
 * `ConfigurationRepository` once a real `DB` binding exists (see `wrangler.jsonc`).
 *
 * `register()` also runs under `npm run dev` (Node) and under `vitest` (also Node), where
 * `"cloudflare:workers"` does not exist — dynamically importing it and swallowing the failure is
 * what lets this file run unconditionally everywhere instead of needing environment sniffing at
 * the call site. `getConfigurationRepository()` keeps defaulting to
 * `InMemoryConfigurationRepository` whenever this block doesn't run, which is exactly what local
 * development and tests want (`lib/server/configurationRepository.ts`'s own doc comment: swap the
 * implementation explicitly, never by guessing the environment).
 */
export async function register(): Promise<void> {
  let cloudflareEnv: { DB?: unknown } | undefined;
  try {
    ({ env: cloudflareEnv } = await import("cloudflare:workers"));
  } catch {
    return; // Not running inside a Cloudflare Worker.
  }

  const db = cloudflareEnv?.DB;
  if (!db) return; // Worker runtime, but no D1 binding resolved (e.g. wrangler.jsonc not deployed with a real database_id yet).

  const [{ D1ConfigurationRepository }, { setConfigurationRepository }] = await Promise.all([
    import("./lib/server/d1ConfigurationRepository"),
    import("./lib/server/configurationRepository"),
  ]);
  setConfigurationRepository(new D1ConfigurationRepository(db as ConstructorParameters<typeof D1ConfigurationRepository>[0]));
}
