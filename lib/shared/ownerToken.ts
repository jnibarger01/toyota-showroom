/**
 * Per-configuration capability tokens.
 *
 * `POST /api/v1/configurations` currently has no notion of who created a record: any client that
 * later learns a `configurationId` — which can leak through a shared URL, browser history, or a
 * referrer header — can PATCH or DELETE someone else's saved build. There is no user-account system
 * to authenticate against, so this implements the minimum that actually closes the gap: the server
 * mints a random token at creation time, stores only its hash, and returns the plaintext token to
 * the creator exactly once. Every subsequent write must present that token; reads stay open, since
 * "read" is what the (separately tracked) sharing feature needs to keep working.
 *
 * Deliberately per-configuration rather than per-device: a leaked token compromises one saved build,
 * not every configuration a browser has ever created, and it needs no separate provisioning step —
 * `create` and "get an owner token" are the same call.
 *
 * `crypto.subtle` and `crypto.getRandomValues` are standard Web Crypto APIs — available in Node 22+,
 * the Workers runtime, and every browser — so this has no extra dependency and is imported by both
 * sides of the ownership check: `lib/server/configurationRepository.ts` (the real API, in-memory
 * today and D1 once Task 7 lands) and `lib/api/localConfigurationTransport.ts` (the browser-only
 * fallback used when no request-aware backend exists, which enforces the identical rule against its
 * own localStorage-backed store for consistency, even though a same-origin browser tab is already
 * its own isolation boundary).
 */

const TOKEN_BYTES = 32; // 256 bits of entropy — comfortably infeasible to guess or brute-force.

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A new plaintext capability token. Return it to the caller once; never store it as given. */
export function generateOwnerToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** SHA-256 of a token, base64url-encoded. This is what repositories persist, never the plaintext. */
export async function hashOwnerToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toBase64Url(new Uint8Array(digest));
}

/**
 * Constant-time equality for the two hash strings. The hash itself already makes guessing
 * infeasible; this only removes the (much weaker, but free to close) timing side-channel a naive
 * `===` comparison leaves on how many leading bytes matched.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verifies a presented plaintext token against a stored hash. */
export async function verifyOwnerToken(token: string | null | undefined, storedHash: string): Promise<boolean> {
  if (!token) return false;
  const candidateHash = await hashOwnerToken(token);
  return timingSafeEqual(candidateHash, storedHash);
}
