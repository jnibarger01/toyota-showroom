/**
 * Prefixes a root-relative asset URL with the deployment's base path.
 *
 * Catalog data stores URLs root-relative (`/renders/…/foo.hdr`), but the GitHub Pages deployment
 * mounts the whole site at a sub-path (`/toyota-showroom/`, `vite.config.ts`'s `base`). A
 * root-relative URL requested there hits the domain root and 404s.
 *
 * Extracted into `lib/shared/` because two layers need it and neither should import the other:
 * `lib/api/client.ts` normalises catalog media through it, and `lib/three/hdriEnvironment.ts` loads
 * an HDR straight from `HDRI_PRESETS` without passing through the API SDK at all. That gap was a
 * real bug — the only preset carrying an `hdrUrl` 404'd under Pages, so both the idle prefetch and
 * the WebGPU image-based-lighting path silently failed on the deployment they were written for, and
 * "Golden Hour" shipped with no environment map. Importing the client SDK from a `lib/three` module
 * would have fixed it while pulling the whole API layer into the Three.js chunk.
 *
 * Absolute URLs and data URIs are returned unchanged: they already name their own origin.
 */
export function withBasePath(url: string): string {
  if (!url.startsWith("/")) return url;
  const base = (import.meta.env?.BASE_URL ?? "/").replace(/\/$/, "");
  return `${base}${url}`;
}
