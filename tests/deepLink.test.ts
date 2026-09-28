import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api/errors";
import {
  createBuildDeepLinkUrl,
  decodeBuildDeepLink,
  encodeBuildDeepLink,
  readBuildDeepLinkParam,
  readBuildDeepLinkRestore,
  stripBuildDeepLinkParam,
  validateBuildDeepLink,
} from "../lib/showroom/deepLink";
import type { CameraState, SelectionMap } from "../lib/types/customization";

const heroCamera: CameraState = {
  presetId: "hero",
  position: [7.5, 4.0, 8.5],
  target: [0, 1.1, 0],
};

describe("build deep-link encode/decode", () => {
  it("round-trips a 4Runner multi-option build with camera", () => {
    const selections: SelectionMap = {
      paint: ["paint-3u5-barcelona-red"],
      wheels: ["wheels-weisu-bronze"],
      accessory: ["accessory-roof-rack", "accessory-rock-sliders"],
    };
    const encoded = encodeBuildDeepLink({
      gradeId: "trd-pro",
      selections,
      cameraState: heroCamera,
    });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded.length).toBeLessThan(800);

    const decoded = decodeBuildDeepLink(encoded);
    expect(decoded.gradeId).toBe("trd-pro");
    expect(decoded.selections).toEqual(selections);
    expect(decoded.cameraState).toEqual(heroCamera);

    const validated = validateBuildDeepLink("4runner", 2024, encoded);
    expect(validated.selections).toEqual(selections);
    expect(validated.cameraState).toEqual(heroCamera);
  });

  it("round-trips an AE86 paint-only catalog selection", () => {
    const selections: SelectionMap = { paint: ["paint-3p0-classic-red"] };
    const encoded = encodeBuildDeepLink({ gradeId: "gt-s", selections });
    const validated = validateBuildDeepLink("ae86", 1985, encoded);
    expect(validated.gradeId).toBe("gt-s");
    expect(validated.selections).toEqual(selections);
    expect(validated.cameraState).toBeUndefined();
  });

  it("builds a share URL with the c query param", () => {
    const url = createBuildDeepLinkUrl("https://example.test", "/4runner/", {
      gradeId: "trd-pro",
      selections: { paint: ["paint-1j9-ice-cap"] },
    });
    expect(url.startsWith("https://example.test/4runner/?c=")).toBe(true);
    const encoded = readBuildDeepLinkParam(new URL(url).search);
    expect(encoded).toBeTruthy();
    expect(validateBuildDeepLink("4runner", 2024, encoded!).selections.paint).toEqual(["paint-1j9-ice-cap"]);
  });

  it("reads the c param from a search string", () => {
    expect(readBuildDeepLinkParam("?c=abc")).toBe("abc");
    expect(readBuildDeepLinkParam("c=abc&x=1")).toBe("abc");
    expect(readBuildDeepLinkParam("")).toBeNull();
    expect(readBuildDeepLinkParam("?other=1")).toBeNull();
  });

  it("rejects malformed base64 / JSON / schema versions", () => {
    expect(() => decodeBuildDeepLink("%%%")).toThrow(ApiError);
    expect(() => decodeBuildDeepLink("not-json")).toThrow(ApiError);
    // Valid base64url of `{"v":99,"g":"x","s":{}}`
    const badVersion = encodeBuildDeepLink({ gradeId: "trd-pro", selections: {} }).replace(
      // Force a different payload via direct encode of a wrong version object through the public API
      // is impossible — craft one by re-encoding JSON manually.
      /^/,
      "",
    );
    void badVersion;
    const crafted = Buffer.from(JSON.stringify({ v: 99, g: "trd-pro", s: {} }), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(() => decodeBuildDeepLink(crafted)).toThrow(/Unsupported deep-link schema version/);
  });

  it("rejects unknown option ids and grade-incompatible paints via the saved-config validators", () => {
    const unknown = encodeBuildDeepLink({
      gradeId: "trd-pro",
      selections: { paint: ["paint-does-not-exist"] },
    });
    expect(() => validateBuildDeepLink("4runner", 2024, unknown)).toThrow(/Unknown option id/);

    // Solar Octane is TRD Pro-only — SR5 must reject it the same way a saved config would.
    const gradeClash = encodeBuildDeepLink({
      gradeId: "sr5",
      selections: { paint: ["paint-0r2-solar-octane"] },
    });
    expect(() => validateBuildDeepLink("4runner", 2024, gradeClash)).toThrow(/not available on grade "sr5"/);
  });

  it("rejects invalid camera vectors with the same camera validator as saved configs", () => {
    const crafted = Buffer.from(
      JSON.stringify({
        v: 1,
        g: "trd-pro",
        s: { paint: ["paint-1j9-ice-cap"] },
        c: { p: [1, 2], t: [0, 0, 0] },
      }),
      "utf8",
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(() => validateBuildDeepLink("4runner", 2024, crafted)).toThrow(/cameraState\.position/);
  });

  it("does not put GLB node names into the encoded payload", () => {
    const encoded = encodeBuildDeepLink({
      gradeId: "trd-pro",
      selections: { paint: ["paint-3u5-barcelona-red"] },
      cameraState: heroCamera,
    });
    const json = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/") + "==", "base64").toString("utf8");
    expect(json).not.toMatch(/BODY|body\.carmain|MOUNT_/);
    expect(json).toContain("paint-3u5-barcelona-red");
  });
});

/**
 * The builder's bootstrap needs three outcomes, not two: "no link" must stay silent, "bad link" must
 * be reported. Collapsing them into `null` (the previous behaviour) is exactly how a visitor ended up
 * looking at a resumed build under someone else's share URL with no explanation.
 */
describe("readBuildDeepLinkRestore", () => {
  it("reports absence for a search string with no c param", () => {
    expect(readBuildDeepLinkRestore("4runner", 2024, "")).toEqual({ status: "absent" });
    expect(readBuildDeepLinkRestore("4runner", 2024, "?other=1")).toEqual({ status: "absent" });
  });

  it("distinguishes an empty c= from a malformed one", () => {
    // `?c=` with no value is not a link at all — stays silent, matching readBuildDeepLinkParam.
    expect(readBuildDeepLinkRestore("4runner", 2024, "?c=")).toEqual({ status: "absent" });
    // Non-empty but undecodable is a broken link, and it carries the reason.
    const broken = readBuildDeepLinkRestore("4runner", 2024, "?c=%%%25");
    expect(broken.status).toBe("invalid");
    expect(broken.status === "invalid" && broken.reason).toMatch(/base64url/);
  });

  it("restores a valid link with validated selections", () => {
    const encoded = encodeBuildDeepLink({
      gradeId: "trd-pro",
      selections: { paint: ["paint-1j9-ice-cap"] },
      cameraState: heroCamera,
    });
    const result = readBuildDeepLinkRestore("4runner", 2024, `?c=${encoded}`);
    expect(result.status).toBe("restored");
    expect(result.status === "restored" && result.build.selections.paint).toEqual(["paint-1j9-ice-cap"]);
    expect(result.status === "restored" && result.build.cameraState).toEqual(heroCamera);
  });

  it("classifies stale and cross-vehicle links as invalid, never as absent", () => {
    const unknown = encodeBuildDeepLink({
      gradeId: "trd-pro",
      selections: { paint: ["paint-does-not-exist"] },
    });
    const stale = readBuildDeepLinkRestore("4runner", 2024, `?c=${unknown}`);
    expect(stale.status).toBe("invalid");
    expect(stale.status === "invalid" && stale.reason).toMatch(/Unknown option id/);

    const gradeClash = encodeBuildDeepLink({
      gradeId: "sr5",
      selections: { paint: ["paint-0r2-solar-octane"] },
    });
    expect(readBuildDeepLinkRestore("4runner", 2024, `?c=${gradeClash}`).status).toBe("invalid");

    // A 4Runner link opened on the AE86 page: the vehicle-identity check refuses it.
    expect(readBuildDeepLinkRestore("ae86", 1985, `?c=${unknown}`).status).toBe("invalid");
  });
});

describe("stripBuildDeepLinkParam", () => {
  it("removes only the c param and keeps the rest of the query", () => {
    expect(stripBuildDeepLinkParam("?c=abc&utm=email")).toBe("?utm=email");
    expect(stripBuildDeepLinkParam("?utm=email&c=abc")).toBe("?utm=email");
  });

  it("returns an empty string when c was the only param or nothing was present", () => {
    expect(stripBuildDeepLinkParam("?c=abc")).toBe("");
    expect(stripBuildDeepLinkParam("")).toBe("");
    expect(stripBuildDeepLinkParam("?other=1")).toBe("?other=1");
  });
});
