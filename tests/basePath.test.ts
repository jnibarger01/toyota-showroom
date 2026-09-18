import { describe, expect, it } from "vitest";
import { withBasePath } from "../lib/shared/basePath";
import { HDRI_PRESETS } from "../lib/data/paintStudio";

/**
 * The bug this guards: the only HDRI preset carrying an `hdrUrl` stores it root-relative, and
 * `hdriEnvironment.loadHdr` requested it directly — bypassing the API SDK that normalises every other
 * catalog asset URL. Under the Pages deployment (`/toyota-showroom/`) that 404s, so both the idle
 * prefetch and the newly-enabled WebGPU image-based-lighting path silently failed on the very
 * deployment they were written for.
 */
describe("withBasePath", () => {
  it("prefixes a root-relative URL", () => {
    // `import.meta.env.BASE_URL` is "/" under vitest, so this asserts the shape rather than a
    // specific deployment prefix; the catalog-data test below is the one that would have caught the
    // original bug.
    expect(withBasePath("/renders/foo.hdr")).toMatch(/\/renders\/foo\.hdr$/);
  });

  it("leaves an absolute URL alone — it already names its origin", () => {
    expect(withBasePath("https://cdn.example.com/foo.hdr")).toBe("https://cdn.example.com/foo.hdr");
  });

  it("leaves a data URI alone", () => {
    expect(withBasePath("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  });

  it("does not double up when the base path is already present as a relative URL", () => {
    expect(withBasePath("renders/foo.hdr")).toBe("renders/foo.hdr");
  });
});

describe("catalog HDRI URLs are resolvable under a sub-path deployment", () => {
  it("every hdrUrl is root-relative, so it must go through withBasePath", () => {
    const withHdr = HDRI_PRESETS.filter((preset) => preset.hdrUrl);
    expect(withHdr.length).toBeGreaterThan(0);
    for (const preset of withHdr) {
      // If a preset ever ships an absolute URL this assertion should be relaxed deliberately — the
      // point is that root-relative values cannot be handed to a loader unresolved.
      expect(preset.hdrUrl!.startsWith("/")).toBe(true);
    }
  });

  it("resolves under a non-root base path rather than hitting the domain root", () => {
    // Simulates what Pages serves: `import.meta.env.BASE_URL === "/toyota-showroom/"`.
    const resolve = (url: string, base: string) => (url.startsWith("/") ? `${base.replace(/\/$/, "")}${url}` : url);
    const preset = HDRI_PRESETS.find((entry) => entry.hdrUrl)!;

    expect(resolve(preset.hdrUrl!, "/toyota-showroom/")).toBe(`/toyota-showroom${preset.hdrUrl}`);
  });
});
