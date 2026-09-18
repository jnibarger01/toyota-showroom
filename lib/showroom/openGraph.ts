import type { Metadata } from "next";
import { getOptionsForVehicle } from "../data/options";
import { absoluteAssetUrl, absolutePageUrl, SITE_URL } from "../site";
import type { SelectionMap } from "../types/customization";
import type { Vehicle } from "../types/vehicle";
import {
  DEEP_LINK_QUERY_PARAM,
  encodeBuildDeepLink,
  type BuildDeepLinkInput,
  type DecodedBuildDeepLink,
} from "./deepLink";

/**
 * Open Graph / Twitter card copy for shareable deep-link builds (#41).
 *
 * Pure catalog lookups — never invents labels, never trusts client-authored display strings.
 * Pages bake vehicle-level cards into static HTML; the Worker `share-card` route can supply
 * grade + paint + wheels from `?c=` at request time.
 */

export const FALLBACK_OG_TITLE = "Toyota Showroom";
export const FALLBACK_OG_DESCRIPTION =
  "Explore and configure Toyota vehicles in a WebGPU showroom — paint, wheels, and more.";

/** Default hero still when a vehicle has no media.hero (should not happen for catalog entries). */
export const FALLBACK_OG_IMAGE_PATH = "/images/modsnation_7416_final_hero_tweaked.png";

export interface SharePreviewParts {
  title: string;
  description: string;
  /** Absolute https URL for og:image / twitter:image. */
  imageUrl: string;
  imageAlt: string;
  /** Absolute page URL used as og:url / canonical when known. */
  pageUrl: string;
}

export interface BuildSharePreviewInput {
  vehicle: Vehicle;
  /** When set (from a validated deep link), title/description include grade + paint + wheels. */
  deepLink?: Pick<DecodedBuildDeepLink, "gradeId" | "selections">;
  /** Override page URL (share-card uses the builder deep-link URL). */
  pageUrl?: string;
}

function vehicleLabel(vehicle: Vehicle): string {
  return `${vehicle.year} ${vehicle.model}`;
}

function resolveGradeName(vehicle: Vehicle, gradeId: string | undefined): string | undefined {
  if (!gradeId) return undefined;
  return vehicle.grades.find((grade) => grade.id === gradeId)?.name;
}

function firstSelectedLabel(
  vehicleId: string,
  selections: SelectionMap | undefined,
  category: "paint" | "wheels",
): string | undefined {
  const optionId = selections?.[category]?.[0];
  if (!optionId) return undefined;
  return getOptionsForVehicle(vehicleId).find((option) => option.id === optionId)?.label;
}

function joinWithAnd(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/**
 * Builds title / description / image for a vehicle page, optionally enriched from a deep-link
 * payload (`gradeId` + paint/wheels selections).
 */
export function buildSharePreview(input: BuildSharePreviewInput): SharePreviewParts {
  const { vehicle, deepLink } = input;
  const label = vehicleLabel(vehicle);
  const gradeName = resolveGradeName(vehicle, deepLink?.gradeId);
  const paintLabel = firstSelectedLabel(vehicle.slug, deepLink?.selections, "paint");
  const wheelsLabel = firstSelectedLabel(vehicle.slug, deepLink?.selections, "wheels");

  const titleBits = [gradeName, paintLabel, wheelsLabel].filter((part): part is string => Boolean(part));
  const title =
    titleBits.length > 0
      ? `${label} ${titleBits.join(" · ")} | Toyota Showroom`
      : `${label} | Toyota Showroom`;

  const subject = gradeName ? `${label} ${gradeName}` : label;
  const optionBits: string[] = [];
  if (paintLabel) optionBits.push(`${paintLabel} paint`);
  if (wheelsLabel) optionBits.push(`${wheelsLabel} wheels`);

  const description =
    optionBits.length > 0
      ? `${subject} with ${joinWithAnd(optionBits)}.`
      : `Configure the ${subject} — paint, wheels, accessories, and more.`;

  const hero = vehicle.media?.hero;
  const imagePath = hero?.url ?? FALLBACK_OG_IMAGE_PATH;
  const imageAlt = hero?.alt ?? `${label} showroom preview`;

  return {
    title,
    description,
    imageUrl: absoluteAssetUrl(imagePath),
    imageAlt,
    pageUrl: input.pageUrl ?? absolutePageUrl(vehicle.slug),
  };
}

export function buildFallbackSharePreview(pageUrl: string = absolutePageUrl()): SharePreviewParts {
  return {
    title: FALLBACK_OG_TITLE,
    description: FALLBACK_OG_DESCRIPTION,
    imageUrl: absoluteAssetUrl(FALLBACK_OG_IMAGE_PATH),
    imageAlt: "Toyota Showroom hero still",
    pageUrl,
  };
}

/** Maps preview parts onto Next.js Metadata `openGraph` + `twitter` fields. */
export function sharePreviewToMetadata(preview: SharePreviewParts): Metadata {
  return {
    title: preview.title,
    description: preview.description,
    openGraph: {
      type: "website",
      siteName: "Toyota Showroom",
      title: preview.title,
      description: preview.description,
      url: preview.pageUrl,
      images: [
        {
          url: preview.imageUrl,
          alt: preview.imageAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: preview.title,
      description: preview.description,
      images: [preview.imageUrl],
    },
  };
}

/**
 * Worker-only share URL: `/api/v1/share-card?slug=&c=` returns OG HTML for crawlers and redirects
 * browsers to `/[slug]/?c=…`. Prefer this when persistence mode is `worker`; Pages keeps the plain
 * deep link (static vehicle OG is already on `/[slug]/`).
 */
export function createShareCardUrl(
  origin: string,
  basePath: string,
  slug: string,
  input: BuildDeepLinkInput,
): string {
  const encoded = encodeBuildDeepLink(input);
  const normalizedBase = basePath.replace(/\/$/, "");
  const path = `${normalizedBase}/api/v1/share-card`;
  const url = new URL(path.startsWith("/") ? path : `/${path}`, origin.endsWith("/") ? origin : `${origin}/`);
  url.searchParams.set("slug", slug);
  url.searchParams.set(DEEP_LINK_QUERY_PARAM, encoded);
  return url.toString();
}

/** Heuristic for link-preview crawlers that need 200 + HTML (not a 302) to read OG tags. */
export function isSocialCrawlerUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return /bot|crawler|spider|slurp|facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|discordbot|whatsapp|telegrambot|skypeuripreview|applebot|redditbot|embedly|quora link preview|outbrain|pinterest|vkshare|w3c_validator|flipboard|tumblr|bitlybot|nuzzel/i.test(
    userAgent,
  );
}

export { SITE_URL };
