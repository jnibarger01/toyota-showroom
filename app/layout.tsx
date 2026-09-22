import type { Metadata } from "next";
import "./globals.css";
import { PAGES_BASE_PATH, SITE_URL } from "../lib/site";

export const metadata: Metadata = {
  title: "Toyota Showroom",
  description: "Explore and configure Toyota vehicles in a WebGPU showroom — paint, wheels, and more.",
  // Base for absolute OG/canonical URLs under the GitHub Pages project path (#78).
  metadataBase: new URL(`${SITE_URL}/`),
  manifest: `${PAGES_BASE_PATH}/site.webmanifest`,
  icons: {
    icon: [
      { url: `${PAGES_BASE_PATH}/favicon.png`, type: "image/png", sizes: "64x64" },
      { url: `${PAGES_BASE_PATH}/icon-192.png`, type: "image/png", sizes: "192x192" },
      { url: `${PAGES_BASE_PATH}/icon-512.png`, type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: `${PAGES_BASE_PATH}/apple-touch-icon.png`, type: "image/png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    siteName: "Toyota Showroom",
    title: "Toyota Showroom",
    description: "Explore and configure Toyota vehicles in a WebGPU showroom — paint, wheels, and more.",
    url: `${SITE_URL}/`,
    images: [{ url: `${SITE_URL}/images/modsnation_7416_final_hero_tweaked.png`, alt: "Toyota Showroom hero still" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Toyota Showroom",
    description: "Explore and configure Toyota vehicles in a WebGPU showroom — paint, wheels, and more.",
    images: [`${SITE_URL}/images/modsnation_7416_final_hero_tweaked.png`],
  },
};

/**
 * The static HTML shell's own security policy — a different surface from `app/api/v1/**`'s
 * (`lib/server/securityHeaders.ts`), and delivered a different way. GitHub Pages has no server to
 * attach response headers with, so this meta tag is the only mechanism that can reach that target
 * at all.
 *
 * Per spec, a `<meta http-equiv="Content-Security-Policy">` tag cannot enforce `frame-ancestors`
 * or `sandbox` — they are header-only directives, silently ignored here. `public/_headers` now
 * sends the same policy plus `frame-ancestors 'none'` as a real header, so the Cloudflare Workers
 * deployment does get clickjacking protection; GitHub Pages, which does not read `_headers`,
 * still cannot (a property of the host, not of this policy — see docs/INTEGRATION_GUIDE.md's
 * Known gaps).
 *
 * The two copies must agree. `tests/staticHeaders.test.ts` asserts they do, on every directive
 * they share, so loosening one to make a feature work cannot quietly leave the other target
 * behind.
 *
 * `'unsafe-inline'` on `script-src`/`style-src` is a deliberate, common tradeoff, not an
 * oversight: the RSC hydration payload ships as an inline `<script>` whose content differs per
 * prerendered page (a nonce needs a server to mint one per request; a hash needs a build step to
 * compute one per page's differing content — both were judged not worth the complexity for a
 * prototype with no user-PII surface beyond an anonymous, self-service local build). Inline
 * `style={{ background: option.materialConfig?.color }}` (`CustomizationButton.tsx`'s paint
 * swatches) needs the same allowance. `'wasm-unsafe-eval'` is required by the vendored Draco/Basis
 * decoders' Emscripten-generated glue code, and `connect-src` needs `blob:`/`data:` because
 * `GLTFLoader`'s internal loaders `fetch()` both — both verified empirically with Playwright
 * (console monitoring for CSP violation reports across the builder, explore, and compare pages)
 * before committing this policy, not assumed safe.
 *
 * The `content` value below is a single inlined string literal, not the more readable
 * `[...].join("; ")` this started as — deliberately. With that array-plus-join version *and* more
 * than one `<meta>` element in `<head>`, vinext's static-export prerenderer produces an HTML/RSC
 * payload mismatch that fails client hydration with React error #418, reproduced and isolated by
 * bisecting down to exactly that combination (a literal `content` string, or only a single `<meta>`
 * child, both hydrate cleanly on their own). Root cause is inside vinext's head-serialization, not
 * this app's code; inlining the literal is the verified-working shape until that's fixed upstream.
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'"
        />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
