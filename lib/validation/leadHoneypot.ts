/** Field name bots tend to fill; humans never see it. */
export const LEAD_HONEYPOT_FIELD = "companyWebsite" as const;

/** Soft dwell before a real submit is accepted on the client. */
export const LEAD_MIN_SUBMIT_MS = 800;

/** True when the honeypot is present and non-empty (or a non-string). */
export function isLeadHoneypotTriggered(body: unknown): boolean {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
  const value = (body as Record<string, unknown>)[LEAD_HONEYPOT_FIELD];
  if (value === undefined || value === null) return false;
  if (typeof value !== "string") return true;
  return value.trim().length > 0;
}

/** Remove the honeypot so `validateCreateLead` still rejects other unknown fields. */
export function stripLeadHoneypotField(body: unknown): unknown {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return body;
  const { [LEAD_HONEYPOT_FIELD]: _honeypot, ...rest } = body as Record<string, unknown>;
  return rest;
}

export function isSuspiciouslyFastLeadSubmit(
  mountedAtMs: number,
  nowMs: number = Date.now(),
  minMs: number = LEAD_MIN_SUBMIT_MS,
): boolean {
  return nowMs - mountedAtMs < minMs;
}

/** Client-side silent drop: honeypot filled or submit too soon after mount. */
export function shouldSilentlyDropLeadClient(options: {
  companyWebsite: string;
  mountedAtMs: number;
  nowMs?: number;
  minMs?: number;
}): boolean {
  if (options.companyWebsite.trim().length > 0) return true;
  return isSuspiciouslyFastLeadSubmit(
    options.mountedAtMs,
    options.nowMs ?? Date.now(),
    options.minMs ?? LEAD_MIN_SUBMIT_MS,
  );
}
