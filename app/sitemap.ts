import type { MetadataRoute } from "next";
import { buildPagesSitemapEntries } from "../lib/site";

/**
 * Pages sitemap: explore + every catalog vehicle slug under the Pages base.
 * Vinext `output: "export"` does not emit this file into dist/client, so
 * `scripts/generate-static-api.ts` also writes `public/sitemap.xml` from the same helper.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return buildPagesSitemapEntries();
}
