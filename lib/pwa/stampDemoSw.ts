/**
 * Pure rewrite of the demo service worker's `CACHE_VERSION` declaration.
 * Used by `scripts/stamp-demo-sw.mjs` (and unit tests) so deploys bump the cache name (#49).
 */
export function stampDemoSwSource(source: string, version: string): string {
  if (!/const CACHE_VERSION = "[^"]*";/.test(source)) {
    throw new Error("CACHE_VERSION declaration not found in service worker source");
  }
  return source.replace(/const CACHE_VERSION = "[^"]*";/, `const CACHE_VERSION = "${version}";`);
}
