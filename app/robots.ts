import type { MetadataRoute } from "next";
import { buildPagesRobots } from "../lib/site";

/**
 * Robots for the Pages export — points crawlers at the Pages-base sitemap.
 * Mirrored into `public/robots.txt` by the prebuild static generator (vinext export gap).
 */
export default function robots(): MetadataRoute.Robots {
  return buildPagesRobots();
}
