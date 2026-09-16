import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import sitemap from "../app/sitemap";
import robots from "../app/robots";
import { getAllVehicleSlugs } from "../lib/data/vehicles";
import {
  SITE_URL,
  absolutePageUrl,
  buildPagesSitemapEntries,
  renderRobotsTxt,
  renderSitemapXml,
} from "../lib/site";

describe("Pages robots + sitemap (#78)", () => {
  it("lists explore and every catalog vehicle slug under the Pages base", () => {
    const entries = buildPagesSitemapEntries();
    const urls = entries.map((entry) => entry.url);

    expect(urls).toContain(absolutePageUrl("explore"));
    expect(sitemap().map((e) => e.url)).toEqual(urls);

    const vehicleUrls = urls.filter((url) => url !== absolutePageUrl("explore"));
    expect(vehicleUrls.sort()).toEqual(
      getAllVehicleSlugs()
        .map((slug) => absolutePageUrl(slug))
        .sort(),
    );
  });

  it("renders sitemap XML whose <loc> slugs match the catalog", () => {
    const xml = renderSitemapXml();
    expect(xml).toContain(absolutePageUrl("explore"));

    const locSlugs = [...xml.matchAll(/\/toyota-showroom\/([^/<]+)\/<\/loc>/g)].map((m) => m[1]!);
    const vehicleSlugs = locSlugs.filter((slug) => slug !== "explore").sort();
    expect(vehicleSlugs).toEqual([...getAllVehicleSlugs()].sort());
  });

  it("points robots.txt at the Pages-base sitemap", () => {
    const doc = robots();
    expect(doc.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
    expect(renderRobotsTxt()).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
  });

  it("keeps absolutePageUrl on the Pages project path with trailing slashes", () => {
    expect(absolutePageUrl()).toBe("https://jnibarger01.github.io/toyota-showroom/");
    expect(absolutePageUrl("explore")).toBe("https://jnibarger01.github.io/toyota-showroom/explore/");
    expect(absolutePageUrl("4runner")).toBe("https://jnibarger01.github.io/toyota-showroom/4runner/");
  });
});

/**
 * Acceptance: built dist includes sitemap; slugs match catalog.
 * Soft when dist is absent (CI unit job runs before build); after `npm run build` this pins the
 * public/ → dist/client copy. CI re-checks with VERIFY_DIST=1 after the build step.
 */
describe("built dist sitemap (#78)", () => {
  const distSitemap = path.resolve(__dirname, "../dist/client/sitemap.xml");
  const distRobots = path.resolve(__dirname, "../dist/client/robots.txt");
  const requireDist = process.env.VERIFY_DIST === "1";

  it("emits sitemap.xml whose <loc> vehicle slugs match the catalog", () => {
    if (!existsSync(distSitemap)) {
      if (requireDist) expect(existsSync(distSitemap)).toBe(true);
      return;
    }

    const xml = readFileSync(distSitemap, "utf8");
    expect(xml).toContain(absolutePageUrl("explore"));

    const locSlugs = [...xml.matchAll(/\/toyota-showroom\/([^/<]+)\/<\/loc>/g)].map((m) => m[1]!);
    const vehicleSlugs = locSlugs.filter((slug) => slug !== "explore").sort();
    expect(vehicleSlugs).toEqual([...getAllVehicleSlugs()].sort());
  });

  it("emits robots.txt referencing the Pages sitemap", () => {
    if (!existsSync(distRobots)) {
      if (requireDist) expect(existsSync(distRobots)).toBe(true);
      return;
    }

    const text = readFileSync(distRobots, "utf8");
    expect(text).toMatch(/Sitemap:\s*https:\/\/jnibarger01\.github\.io\/toyota-showroom\/sitemap\.xml/);
  });
});
