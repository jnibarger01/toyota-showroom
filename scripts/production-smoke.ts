import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 1_000_000;

export type SmokeCheck = { name: string; status: number; durationMs: number };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function normalizeBaseUrl(value: string): URL {
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  assert(url.protocol === "https:" || (local && url.protocol === "http:"), "Smoke target must use HTTPS (HTTP is allowed only for localhost)." );
  assert(!url.username && !url.password, "Smoke target URL must not contain credentials.");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/`;
  url.search = "";
  url.hash = "";
  return url;
}

async function readJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  assert(!declaredLength || declaredLength <= MAX_RESPONSE_BYTES, `Response exceeded ${MAX_RESPONSE_BYTES} bytes.`);
  const text = await response.text();
  assert(Buffer.byteLength(text) <= MAX_RESPONSE_BYTES, `Response exceeded ${MAX_RESPONSE_BYTES} bytes.`);
  try { return JSON.parse(text); } catch { throw new Error("Response was not valid JSON."); }
}

function assertSecurityHeaders(response: Response): void {
  assert(response.headers.get("x-content-type-options") === "nosniff", "Missing X-Content-Type-Options: nosniff.");
  assert(response.headers.has("content-security-policy"), "Missing Content-Security-Policy.");
}

async function check(
  baseUrl: URL,
  path: string,
  validate: (body: any, response: Response) => void,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<SmokeCheck> {
  const startedAt = Date.now();
  const response = await fetchImpl(new URL(path.replace(/^\//, ""), baseUrl), {
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  assert(response.status === 200, `${path} returned HTTP ${response.status}.`);
  assert((response.headers.get("content-type") ?? "").includes("application/json"), `${path} did not return JSON.`);
  assertSecurityHeaders(response);
  const body = await readJson(response);
  validate(body, response);
  return { name: path, status: response.status, durationMs: Date.now() - startedAt };
}

export async function runProductionSmoke(
  target: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<SmokeCheck[]> {
  const baseUrl = normalizeBaseUrl(target);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  assert(Number.isFinite(timeoutMs) && timeoutMs > 0, "timeoutMs must be positive.");

  return [
    await check(baseUrl, "api/v1/health", (body) => {
      assert(body?.status === "ok", "Health status was not ok.");
      assert(Number.isInteger(body?.vehicleCount) && body.vehicleCount > 0, "Health vehicleCount was invalid.");
      assert(typeof body?.schemaVersion === "string" && body.schemaVersion.length > 0, "Health schemaVersion was invalid.");
      assert(!Number.isNaN(Date.parse(body?.timestamp)), "Health timestamp was invalid.");
    }, fetchImpl, timeoutMs),
    await check(baseUrl, "api/v1/vehicles?limit=1", (body) => {
      assert(typeof body?.schemaVersion === "string" && body.schemaVersion.length > 0, "Catalog schemaVersion was invalid.");
      assert(Array.isArray(body?.data) && body.data.length === 1, "Catalog smoke query did not return exactly one vehicle.");
      assert(typeof body.data[0]?.slug === "string" && body.data[0].slug.length > 0, "Catalog vehicle slug was invalid.");
      assert(Number.isInteger(body?.pagination?.total) && body.pagination.total > 0, "Catalog pagination total was invalid.");
    }, fetchImpl, timeoutMs),
  ];
}

async function main(): Promise<void> {
  const target = process.env.SMOKE_BASE_URL;
  assert(target, "SMOKE_BASE_URL is required (example: https://showroom.example.com/)." );
  const checks = await runProductionSmoke(target);
  process.stdout.write(`${JSON.stringify({ status: "ok", target: normalizeBaseUrl(target).origin, checks })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  });
}
