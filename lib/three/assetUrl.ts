/**
 * Single, consistent resolver for asset URLs across the showroom.
 *
 * Deployment base path (Vite `import.meta.env.BASE_URL`) is empty for a root
 * deployment and a non-empty prefix (e.g. `/toyota`) for a subpath deployment.
 * Asset URLs are authored as absolute app paths (`/models/...glb`); this folds
 * the base path in so the same code works under both root and subpath hosting.
 *
 * Mirrors the resolver already used by `lib/api/client.ts` (`withBasePath`) so
 * the whole app has ONE rule for base-path prefixing.
 */

function getBasePath(): string {
  const raw =
    typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : "/";
  return raw.replace(/\/$/, "");
}

/**
 * Prefix an app-absolute asset path with the deployment base path.
 *
 * Already-absolute URLs (http/https) and relative URLs pass through untouched,
 * so remote model URLs and already-resolved paths are never double-prefixed.
 */
export function resolveAssetUrl(url: string, basePath: string = getBasePath()): string {
  if (!url.startsWith("/")) return url;
  if (basePath && (url === basePath || url.startsWith(`${basePath}/`))) return url;
  return `${basePath}${url}`;
}
