import { NextRequest, NextResponse } from "next/server";
import { invalidBody, notFound } from "../../../../lib/api/errors";
import { getVehicleBySlug } from "../../../../lib/data/vehicles";
import { withRouteTelemetry } from "../../../../lib/server/apiResponse";
import { withSecurityHeaders } from "../../../../lib/server/securityHeaders";
import {
  createBuildDeepLinkUrl,
  DEEP_LINK_QUERY_PARAM,
  validateBuildDeepLink,
} from "../../../../lib/showroom/deepLink";
import {
  buildSharePreview,
  isSocialCrawlerUserAgent,
  type SharePreviewParts,
} from "../../../../lib/showroom/openGraph";
import { absolutePageUrl } from "../../../../lib/site";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/share-card?slug=&c=
 *
 * Worker-only unfurl helper for deep-link builds (#41). Social crawlers receive a tiny HTML
 * document with Open Graph / Twitter tags derived from grade + paint + wheels; browsers get a
 * 302 to `/[slug]/?c=…` so the shared URL still opens the live builder.
 *
 * GitHub Pages does not serve this route (`force-dynamic` + no Worker). Pages share links keep
 * using `/[slug]/?c=…` and rely on the vehicle-level OG tags baked into static HTML.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderShareCardHtml(preview: SharePreviewParts, builderUrl: string): string {
  const title = escapeHtml(preview.title);
  const description = escapeHtml(preview.description);
  const imageUrl = escapeHtml(preview.imageUrl);
  const imageAlt = escapeHtml(preview.imageAlt);
  const pageUrl = escapeHtml(preview.pageUrl);
  const href = escapeHtml(builderUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${title}</title>
  <meta name="description" content="${description}"/>
  <link rel="canonical" href="${pageUrl}"/>
  <meta property="og:type" content="website"/>
  <meta property="og:site_name" content="Toyota Showroom"/>
  <meta property="og:title" content="${title}"/>
  <meta property="og:description" content="${description}"/>
  <meta property="og:url" content="${pageUrl}"/>
  <meta property="og:image" content="${imageUrl}"/>
  <meta property="og:image:alt" content="${imageAlt}"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${title}"/>
  <meta name="twitter:description" content="${description}"/>
  <meta name="twitter:image" content="${imageUrl}"/>
  <meta http-equiv="refresh" content="0;url=${href}"/>
</head>
<body>
  <p>Opening <a href="${href}">${title}</a>…</p>
</body>
</html>
`;
}

/** Preserve `/toyota-showroom` (or any mount prefix) from the share-card request path. */
function builderPathForSlug(slug: string, request: NextRequest): string {
  const pathname = request.nextUrl.pathname;
  const apiIdx = pathname.indexOf("/api/v1/share-card");
  const prefix = apiIdx > 0 ? pathname.slice(0, apiIdx) : "";
  return `${prefix}/${slug}/`;
}

export const GET = withRouteTelemetry(
  "/api/v1/share-card",
  "GET",
  async (request: NextRequest) => {
    const slug = request.nextUrl.searchParams.get("slug")?.trim() ?? "";
    if (!slug) throw invalidBody(`"slug" query parameter is required.`);

    const vehicle = getVehicleBySlug(slug);
    if (!vehicle) throw notFound(`Unknown vehicle slug "${slug}".`);

    const encoded = request.nextUrl.searchParams.get(DEEP_LINK_QUERY_PARAM);
    const path = builderPathForSlug(slug, request);
    let preview = buildSharePreview({ vehicle, pageUrl: absolutePageUrl(slug) });
    let builderUrl = `${request.nextUrl.origin}${path}`;

    if (encoded && encoded.trim() !== "") {
      try {
        const decoded = validateBuildDeepLink(vehicle.slug, vehicle.year, encoded);
        builderUrl = createBuildDeepLinkUrl(request.nextUrl.origin, path, {
          gradeId: decoded.gradeId,
          selections: decoded.selections,
          cameraState: decoded.cameraState,
          paintStudio: decoded.paintStudio,
        });
        preview = buildSharePreview({
          vehicle,
          deepLink: decoded,
          pageUrl: builderUrl,
        });
      } catch {
        // Malformed/incompatible `c` — still unfurl the vehicle card and send the visitor to the
        // bare builder (client bootstrap ignores a bad deep link the same way).
        preview = buildSharePreview({ vehicle, pageUrl: absolutePageUrl(slug) });
        builderUrl = `${request.nextUrl.origin}${path}`;
      }
    }

    const userAgent = request.headers.get("user-agent");

    if (!isSocialCrawlerUserAgent(userAgent)) {
      return NextResponse.redirect(builderUrl, {
        status: 302,
        headers: withSecurityHeaders({ "Cache-Control": "no-store" }),
      });
    }

    const html = renderShareCardHtml(preview, builderUrl);
    return new NextResponse(html, {
      status: 200,
      headers: withSecurityHeaders({
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        // HTML (not JSON): keep locked down — meta refresh + one anchor need no script/style/img.
        "Content-Security-Policy":
          "default-src 'none'; style-src 'none'; img-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      }),
    });
  },
);
