/**
 * Lazy-load boundary for QR SVG generation (#50).
 *
 * Kept as a dedicated module so the bundler names the chunk `renderShareQr` (not `dist` from
 * `uqr/dist/…`) and BuilderApp chrome never sync-imports the encoder.
 */
import { renderSVG } from "uqr";

export function renderShareQrSvg(url: string): string {
  return renderSVG(url, { ecc: "M", border: 2 });
}
