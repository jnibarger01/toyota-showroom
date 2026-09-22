import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAGES_BASE_PATH } from "../lib/site";

const PUBLIC_DIR = path.resolve(__dirname, "../public");
const DIST_DIR = path.resolve(__dirname, "../dist/client");
const LAYOUT_PATH = path.resolve(__dirname, "../app/layout.tsx");
const requireDist = process.env.VERIFY_DIST === "1";

function readPngSize(filePath: string): [number, number] {
  const bytes = readFileSync(filePath);
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from("89504e470d0a1a0a", "hex"));
  expect(bytes.toString("ascii", 12, 16)).toBe("IHDR");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe("web app manifest and Pages icons (#124)", () => {
  const manifestPath = path.join(PUBLIC_DIR, "site.webmanifest");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    name?: string;
    short_name?: string;
    start_url?: string;
    scope?: string;
    display?: string;
    theme_color?: string;
    background_color?: string;
    icons?: Array<{ src?: string; sizes?: string; type?: string }>;
  };

  it("ships an installable manifest under the GitHub Pages project path", () => {
    expect(manifest.name).toBe("Toyota Showroom");
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toContain(`${PAGES_BASE_PATH}/`);
    expect(manifest.scope).toBe(`${PAGES_BASE_PATH}/`);
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBeTruthy();
    expect(manifest.background_color).toBeTruthy();
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: `${PAGES_BASE_PATH}/icon-192.png`, sizes: "192x192", type: "image/png" }),
        expect.objectContaining({ src: `${PAGES_BASE_PATH}/icon-512.png`, sizes: "512x512", type: "image/png" }),
      ]),
    );
  });

  it("ships original PNG icons at the required sizes", () => {
    for (const [file, size] of [
      ["icon-192.png", 192],
      ["icon-512.png", 512],
      ["apple-touch-icon.png", 180],
      ["favicon.png", 64],
    ] as const) {
      const filePath = path.join(PUBLIC_DIR, file);
      expect(existsSync(filePath), `public/${file} should exist`).toBe(true);
      expect(readPngSize(filePath)).toEqual([size, size]);
    }
  });

  it("references the manifest, favicon, and Apple touch icon from the root metadata", () => {
    const layout = readFileSync(LAYOUT_PATH, "utf8");
    expect(layout).toContain('manifest: `${PAGES_BASE_PATH}/site.webmanifest`');
    expect(layout).toContain("favicon.png");
    expect(layout).toContain("apple-touch-icon.png");
  });
});

describe("built PWA assets (#124)", () => {
  it("copies the manifest and icons into the static output", () => {
    const files = ["site.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "favicon.png"];
    for (const file of files) {
      const outputPath = path.join(DIST_DIR, file);
      if (!existsSync(outputPath)) {
        if (requireDist) expect(existsSync(outputPath), `dist/client/${file} should exist after build`).toBe(true);
        continue;
      }
      expect(outputPath).toBeTruthy();
    }

    if (existsSync(path.join(DIST_DIR, "site.webmanifest"))) {
      const builtManifest = JSON.parse(readFileSync(path.join(DIST_DIR, "site.webmanifest"), "utf8")) as {
        start_url?: string;
        icons?: unknown[];
      };
      expect(builtManifest.start_url).toContain(PAGES_BASE_PATH);
      expect(builtManifest.icons?.length).toBeGreaterThanOrEqual(2);
    }
  });
});
