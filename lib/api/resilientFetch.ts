export interface ResilientFetchOptions {
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  circuitFailureThreshold?: number;
  circuitResetMs?: number;
}

const DEFAULTS: Required<ResilientFetchOptions> = {
  timeoutMs: 8_000,
  maxRetries: 2,
  baseDelayMs: 100,
  circuitFailureThreshold: 3,
  circuitResetMs: 30_000,
};

type Circuit = { failures: number; openedAt: number | null };
const circuits = new Map<string, Circuit>();

export class ProviderUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProviderUnavailableError";
  }
}

function circuitKey(url: string): string {
  try {
    return new URL(url, "http://local.invalid").origin;
  } catch {
    return url;
  }
}

function retryable(response: Response): boolean {
  return response.status === 408 || response.status === 429 || response.status >= 500;
}

function retryDelay(response: Response | null, attempt: number, baseDelayMs: number): number {
  const retryAfter = response?.headers.get("Retry-After");
  if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1_000;
  return baseDelayMs * 2 ** attempt;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function forwardAbort(source: AbortSignal | null | undefined, target: AbortController): () => void {
  if (!source) return () => {};

  const onAbort = () => target.abort(abortReason(source));
  if (source.aborted) {
    onAbort();
    return () => {};
  }

  source.addEventListener("abort", onAbort, { once: true });
  return () => source.removeEventListener("abort", onAbort);
}

export async function resilientFetch(
  url: string,
  init: RequestInit = {},
  options: ResilientFetchOptions = {},
): Promise<Response> {
  const config = { ...DEFAULTS, ...options };
  const key = circuitKey(url);
  const circuit = circuits.get(key) ?? { failures: 0, openedAt: null };
  const now = Date.now();

  if (circuit.openedAt !== null && now - circuit.openedAt < config.circuitResetMs) {
    throw new ProviderUnavailableError(`Provider circuit is open for ${key}`);
  }
  if (circuit.openedAt !== null) {
    circuit.failures = 0;
    circuit.openedAt = null;
  }

  const method = (init.method ?? "GET").toUpperCase();
  const attempts = method === "GET" || method === "HEAD" ? config.maxRetries + 1 : 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const stopForwardingAbort = forwardAbort(init.signal, controller);
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let response: Response | null = null;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
      if (!retryable(response) || attempt === attempts - 1) {
        if (retryable(response)) throw new ProviderUnavailableError(`Provider returned ${response.status}`);
        circuits.set(key, { failures: 0, openedAt: null });
        return response;
      }
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted) throw error;
      if (attempt === attempts - 1) break;
    } finally {
      clearTimeout(timer);
      stopForwardingAbort();
    }
    await sleep(retryDelay(response, attempt, config.baseDelayMs), init.signal);
  }

  circuit.failures += 1;
  if (circuit.failures >= config.circuitFailureThreshold) circuit.openedAt = Date.now();
  circuits.set(key, circuit);
  throw new ProviderUnavailableError(`Provider request failed for ${key}`, { cause: lastError });
}

export function resetProviderCircuitsForTests(): void {
  circuits.clear();
}
