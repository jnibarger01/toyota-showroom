let workerEnvPromise: Promise<Env | undefined> | undefined;

/**
 * Resolve Worker bindings without making Node/Vitest environments depend on the workerd-only
 * `cloudflare:workers` module. The dynamic import is cached per isolate.
 */
export function getWorkerEnv(): Promise<Env | undefined> {
  workerEnvPromise ??= import("cloudflare:workers")
    .then(({ env }) => env as Env)
    .catch(() => undefined);
  return workerEnvPromise;
}

export async function getD1Binding(): Promise<D1Database | undefined> {
  return (await getWorkerEnv())?.DB;
}

export async function getWriteApiKey(): Promise<string | undefined> {
  const value = (await getWorkerEnv())?.WRITE_API_KEY;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
