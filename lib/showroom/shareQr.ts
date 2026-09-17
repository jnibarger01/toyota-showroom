import {
  createBuildDeepLinkUrl,
  encodeBuildDeepLink,
  type BuildDeepLinkInput,
} from "./deepLink";

/**
 * Floor-to-phone QR share (#50).
 *
 * The QR always encodes the same `?c=` deep link that Share copies under local/demo persistence
 * (`createBuildDeepLinkUrl` → `encodeBuildDeepLink`). That keeps handoff working without Worker/D1
 * and guarantees the payload is option ids only — never GLB node or material names.
 */

/** Full URL placed in the QR matrix — identical to Share copy under local/demo. */
export function createShareQrUrl(
  origin: string,
  pathname: string,
  input: BuildDeepLinkInput,
): string {
  return createBuildDeepLinkUrl(origin, pathname, input);
}

/**
 * Compact `c=` value encoded inside {@link createShareQrUrl}.
 * Unit tests assert this equals `encodeBuildDeepLink(input)` so the QR cannot drift from Share.
 */
export function createShareQrEncodedPayload(input: BuildDeepLinkInput): string {
  return encodeBuildDeepLink(input);
}
