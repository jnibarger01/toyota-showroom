import type { MetadataRoute } from "next";
import { getAllVehicleSlugs } from "./data/vehicles";

/**
 * Absolute public URLs for the GitHub Pages deployment.
 *
 * Vite `base` / next `assetPrefix` are `/toyota-showroom/` at build time
 * (`vite.config.ts`, `next.config.mjs`). Crawlers and OG consumers need fully
 * qualified URLs under that prefix — relative `/explore/` alone resolves against
 * `jnibarger01.github.io`, not the project Pages site.
 */
export const PAGES_ORIGIN = "https://jnibarger01.github.io";
/** Repo Pages mount — no trailing slash. Matches `vite.config.ts` build `base`. */
export const PAGES_BASE_PATH = "/toyota-showroom";
export const SITE_URL = `${PAGES_ORIGIN}${PAGES_BASE_PATH}`;

/**
 * Absolute `https://…/toyota-showroom/[segment]/` URL. Empty segment → site root.
 * Trailing slash matches `next.config.mjs` `trailingSlash: true`.
 */
export function absolutePageUrl(segment: string = ""): string {
  const trimmed = segment.replace(/^\/+|\/+$/g, "");
  return trimmed ? `${SITE_URL}/${trimmed}/` : `${SITE_URL}/`;
}

/** Explore + every catalog vehicle — the Pages sitemap surface for #78. */
export function buildPagesSitemapEntries(): MetadataRoute.Sitemap {
  const explore: MetadataRoute.Sitemap[number] = {
    url: absolutePageUrl("explore"),
    changeFrequency: "weekly",
    priority: 0.9,
  };

  const vehicles = getAllVehicleSlugs().map(
    (slug): MetadataRoute.Sitemap[number] => ({
      url: absolutePageUrl(slug),
      changeFrequency: "weekly",
      priority: 0.8,
    }),
  );

  return [explore, ...vehicles];
}

export function buildPagesRobots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

/** Serialize sitemap entries to the XML protocol vinext's static export does not emit. */
export function renderSitemapXml(entries: MetadataRoute.Sitemap = buildPagesSitemapEntries()): string {
  const body = entries
    .map((entry) => {
      const lines = [`    <loc>${entry.url}</loc>`];
      if (entry.lastModified) {
        const lastmod =
          entry.lastModified instanceof Date ? entry.lastModified.toISOString() : String(entry.lastModified);
        lines.push(`    <lastmod>${lastmod}</lastmod>`);
      }
      if (entry.changeFrequency) lines.push(`    <changefreq>${entry.changeFrequency}</changefreq>`);
      if (entry.priority !== undefined) lines.push(`    <priority>${entry.priority}</priority>`);
      return `  <url>\n${lines.join("\n")}\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function renderRobotsTxt(doc: MetadataRoute.Robots = buildPagesRobots()): string {
  const rules = Array.isArray(doc.rules) ? doc.rules : [doc.rules];
  const blocks = rules.map((rule) => {
    const userAgents = Array.isArray(rule.userAgent) ? rule.userAgent : [rule.userAgent];
    const lines = userAgents.map((ua) => `User-Agent: ${ua}`);
    const allows = rule.allow === undefined ? [] : Array.isArray(rule.allow) ? rule.allow : [rule.allow];
    const disallows =
      rule.disallow === undefined ? [] : Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow];
    for (const allow of allows) lines.push(`Allow: ${allow}`);
    for (const disallow of disallows) lines.push(`Disallow: ${disallow}`);
    return lines.join("\n");
  });

  const sitemapLines = doc.sitemap
    ? (Array.isArray(doc.sitemap) ? doc.sitemap : [doc.sitemap]).map((url) => `Sitemap: ${url}`)
    : [];

  return `${[...blocks, ...sitemapLines].join("\n\n")}\n`;
}
