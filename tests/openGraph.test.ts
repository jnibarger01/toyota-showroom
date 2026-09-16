import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as shareCardGet } from "../app/api/v1/share-card/route";
import { getVehicleBySlug } from "../lib/data/vehicles";
import { encodeBuildDeepLink } from "../lib/showroom/deepLink";
import {
  buildFallbackSharePreview,
  buildSharePreview,
  createShareCardUrl,
  isSocialCrawlerUserAgent,
  sharePreviewToMetadata,
} from "../lib/showroom/openGraph";
import { SITE_URL, absoluteAssetUrl, absolutePageUrl } from "../lib/site";

describe("Open Graph share preview (#41)", () => {
  const fourRunner = getVehicleBySlug("4runner")!;

  it("builds fallback preview for explore/home", () => {
    const preview = buildFallbackSharePreview(absolutePageUrl("explore"));
    expect(preview.title).toBe("Toyota Showroom");
    expect(preview.description.toLowerCase()).toContain("paint");
    expect(preview.imageUrl).toBe(
      absoluteAssetUrl("/images/modsnation_7416_final_hero_tweaked.png"),
    );
    expect(preview.pageUrl).toBe(absolutePageUrl("explore"));
  });

  it("builds vehicle-level preview without a deep link (Pages static card)", () => {
    const preview = buildSharePreview({ vehicle: fourRunner });
    expect(preview.title).toBe("2024 4Runner | Toyota Showroom");
    expect(preview.description).toContain("Configure the 2024 4Runner");
    expect(preview.imageUrl).toBe(absoluteAssetUrl(fourRunner.media.hero.url));
    expect(preview.pageUrl).toBe(absolutePageUrl("4runner"));
  });

  it("enriches title/description from grade + paint + wheels fixtures", () => {
    const preview = buildSharePreview({
      vehicle: fourRunner,
      deepLink: {
        gradeId: "trd-pro",
        selections: {
          paint: ["paint-3u5-barcelona-red"],
          wheels: ["wheels-weisu-bronze"],
        },
      },
    });

    expect(preview.title).toBe(
      "2024 4Runner TRD Pro · Barcelona Red Metallic · WEISU Bronze | Toyota Showroom",
    );
    expect(preview.description).toBe(
      "2024 4Runner TRD Pro with Barcelona Red Metallic paint and WEISU Bronze wheels.",
    );
  });

  it("includes grade alone when paint/wheels are unset", () => {
    const preview = buildSharePreview({
      vehicle: fourRunner,
      deepLink: { gradeId: "sr5", selections: {} },
    });
    expect(preview.title).toBe("2024 4Runner SR5 | Toyota Showroom");
    expect(preview.description).toContain("Configure the 2024 4Runner SR5");
  });

  it("maps preview parts onto Next metadata openGraph + twitter fields", () => {
    const preview = buildSharePreview({
      vehicle: fourRunner,
      deepLink: {
        gradeId: "trd-pro",
        selections: { paint: ["paint-1j9-ice-cap"] },
      },
    });
    const meta = sharePreviewToMetadata(preview);
    expect(meta.title).toBe(preview.title);
    expect(meta.openGraph?.title).toBe(preview.title);
    expect(meta.openGraph?.images).toEqual([{ url: preview.imageUrl, alt: preview.imageAlt }]);
    expect(meta.twitter && "card" in meta.twitter ? meta.twitter.card : undefined).toBe(
      "summary_large_image",
    );
    expect(meta.twitter && "images" in meta.twitter ? meta.twitter.images : undefined).toEqual([
      preview.imageUrl,
    ]);
  });

  it("builds a share-card URL under the Pages base path", () => {
    const url = createShareCardUrl("https://example.test", "/toyota-showroom/", "4runner", {
      gradeId: "trd-pro",
      selections: { paint: ["paint-1j9-ice-cap"] },
    });
    expect(url.startsWith("https://example.test/toyota-showroom/api/v1/share-card?")).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("slug")).toBe("4runner");
    expect(parsed.searchParams.get("c")).toBeTruthy();
  });

  it("detects common social crawler user agents", () => {
    expect(isSocialCrawlerUserAgent("Slackbot-LinkExpanding 1.0")).toBe(true);
    expect(isSocialCrawlerUserAgent("facebookexternalhit/1.1")).toBe(true);
    expect(isSocialCrawlerUserAgent("Twitterbot/1.0")).toBe(true);
    expect(isSocialCrawlerUserAgent("Mozilla/5.0 (Macintosh) Chrome/120")).toBe(false);
  });
});

describe("GET /api/v1/share-card (#41)", () => {
  const encoded = encodeBuildDeepLink({
    gradeId: "trd-pro",
    selections: {
      paint: ["paint-3u5-barcelona-red"],
      wheels: ["wheels-weisu-bronze"],
    },
  });

  function request(ua: string, path = "/api/v1/share-card"): NextRequest {
    const url = new URL(`https://example.test${path}`);
    url.searchParams.set("slug", "4runner");
    url.searchParams.set("c", encoded);
    return new NextRequest(url, { headers: { "user-agent": ua } });
  }

  it("returns OG HTML with grade + options for Slackbot", async () => {
    const response = await shareCardGet(request("Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/html/);
    const html = await response.text();
    expect(html).toContain('property="og:title"');
    expect(html).toContain("TRD Pro");
    expect(html).toContain("Barcelona Red Metallic");
    expect(html).toContain("WEISU Bronze");
    expect(html).toContain(`${SITE_URL}/images/modsnation_7416_final_hero_tweaked.png`);
  });

  it("302-redirects browsers to the builder deep link", async () => {
    const response = await shareCardGet(request("Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120.0.0.0"));
    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toMatch(/\/4runner\/\?c=/);
  });

  it("preserves a /toyota-showroom mount prefix on redirects", async () => {
    const response = await shareCardGet(
      request("Mozilla/5.0", "/toyota-showroom/api/v1/share-card"),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toMatch(
      /^https:\/\/example\.test\/toyota-showroom\/4runner\/\?c=/,
    );
  });

  it("rejects unknown slugs", async () => {
    const url = new URL("https://example.test/api/v1/share-card");
    url.searchParams.set("slug", "not-a-vehicle");
    const response = await shareCardGet(
      new NextRequest(url, { headers: { "user-agent": "Slackbot" } }),
    );
    expect(response.status).toBe(404);
  });
});
