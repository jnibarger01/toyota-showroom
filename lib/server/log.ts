import { requestIdFor } from "./http";

type LogLevel = "info" | "warn" | "error";

/** Emit one-line JSON suitable for Workers Logs/Logpush. */
export function log(
  level: LogLevel,
  event: string,
  request?: Request,
  fields: Record<string, unknown> = {},
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    requestId: requestIdFor(request),
    ...fields,
  };

  // eslint-disable-next-line no-console
  console[level](JSON.stringify(entry));
}
