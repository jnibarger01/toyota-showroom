import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api/errors";
import {
  COMPARE_DEEP_LINK_MAX_URL_LENGTH,
  COMPARE_DEEP_LINK_QUERY_PARAM,
  buildsToCompareDeepLinkInput,
  createCompareDeepLinkUrl,
  decodeCompareDeepLink,
  encodeCompareDeepLink,
  readCompareDeepLinkParam,
  validateCompareDeepLink,
  type CompareDeepLinkBuildInput,
} from "../lib/showroom/compareDeepLink";
import { DEEP_LINK_QUERY_PARAM } from "../lib/showroom/deepLink";
import type { SelectionMap } from "../lib/types/customization";

function build(
  overrides: Partial<CompareDeepLinkBuildInput> &
    Pick<CompareDeepLinkBuildInput, "vehicleId" | "gradeId">,
): CompareDeepLinkBuildInput {
  return {
    modelYear:
      overrides.vehicleId === "ae86" ? 1985 : overrides.vehicleId === "camry" ? 2025 : 2024,
    selections: {},
    ...overrides,
  };
}

describe("garage compare deep-link encode/decode", () => {
  it("round-trips a 2-build compare set with option ids", () => {
    const selectionsA: SelectionMap = {
      paint: ["paint-3u5-barcelona-red"],
      wheels: ["wheels-weisu-bronze"],
    };
    const selectionsB: SelectionMap = {
      paint: ["paint-1j9-ice-cap"],
    };
    const input = [
      build({ vehicleId: "4runner", gradeId: "trd-pro", selections: selectionsA }),
      build({ vehicleId: "4runner", gradeId: "sr5", selections: selectionsB }),
    ];

    const encoded = encodeCompareDeepLink(input);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);

    const decoded = decodeCompareDeepLink(encoded);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toEqual(input[0]);
    expect(decoded[1]).toEqual(input[1]);

    const validated = validateCompareDeepLink(encoded);
    expect(validated).toHaveLength(2);
    expect(validated[0].selections).toEqual(selectionsA);
    expect(validated[1].selections).toEqual(selectionsB);
    expect(validated[0].model).toBe("4Runner");
    expect(validated[0].configurationId).toMatch(/^cmp_0_4runner$/);
    expect(validated[1].configurationId).toMatch(/^cmp_1_4runner$/);
  });

  it("round-trips mixed vehicles up to MAX_COMPARE", () => {
    const input = [
      build({
        vehicleId: "4runner",
        gradeId: "trd-pro",
        selections: { paint: ["paint-218-blueprint"] },
      }),
      build({
        vehicleId: "tacoma",
        gradeId: "sr",
        selections: { paint: ["paint-040-super-white"] },
      }),
      build({
        vehicleId: "ae86",
        gradeId: "gt-s",
        modelYear: 1985,
        selections: { paint: ["paint-3p0-classic-red"] },
      }),
      build({
        vehicleId: "camry",
        gradeId: "le",
        modelYear: 2025,
        selections: {},
      }),
    ];
    const encoded = encodeCompareDeepLink(input);
    const validated = validateCompareDeepLink(encoded);
    expect(validated.map((b) => b.vehicleId)).toEqual([
      "4runner",
      "tacoma",
      "ae86",
      "camry",
    ]);
  });

  it("uses cmp query param, distinct from single-build c=", () => {
    expect(COMPARE_DEEP_LINK_QUERY_PARAM).toBe("cmp");
    expect(COMPARE_DEEP_LINK_QUERY_PARAM).not.toBe(DEEP_LINK_QUERY_PARAM);

    const result = createCompareDeepLinkUrl("https://example.test", "/compare", [
      build({
        vehicleId: "4runner",
        gradeId: "trd-pro",
        selections: { paint: ["paint-1j9-ice-cap"] },
      }),
      build({
        vehicleId: "tacoma",
        gradeId: "sr",
        selections: {},
      }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url.startsWith("https://example.test/compare/?cmp=")).toBe(true);
    expect(result.url).not.toContain(`${DEEP_LINK_QUERY_PARAM}=`);
    expect(result.length).toBeLessThanOrEqual(COMPARE_DEEP_LINK_MAX_URL_LENGTH);

    const encoded = readCompareDeepLinkParam(new URL(result.url).search);
    expect(encoded).toBe(result.encoded);
    expect(validateCompareDeepLink(encoded!).map((b) => b.vehicleId)).toEqual([
      "4runner",
      "tacoma",
    ]);
  });

  it("reads the cmp param from a search string", () => {
    expect(readCompareDeepLinkParam("?cmp=abc")).toBe("abc");
    expect(readCompareDeepLinkParam("cmp=abc&x=1")).toBe("abc");
    expect(readCompareDeepLinkParam("")).toBeNull();
    expect(readCompareDeepLinkParam("?c=single-build")).toBeNull();
    expect(readCompareDeepLinkParam("?builds=cfg_a,cfg_b")).toBeNull();
  });

  it("returns too_long copy-error when the share URL exceeds the cap", () => {
    // Force an oversized payload by padding selections with many unique-looking ids that still
    // encode densely — createCompareDeepLinkUrl checks final URL length after encode.
    const hugeSelections: SelectionMap = {
      accessory: Array.from({ length: 80 }, (_, i) => `accessory-pad-${"x".repeat(40)}-${i}`),
    };
    const input = [
      build({ vehicleId: "4runner", gradeId: "trd-pro", selections: hugeSelections }),
      build({ vehicleId: "tacoma", gradeId: "sr", selections: hugeSelections }),
      build({
        vehicleId: "ae86",
        gradeId: "gt-s",
        modelYear: 1985,
        selections: hugeSelections,
      }),
      build({ vehicleId: "camry", gradeId: "le", modelYear: 2025, selections: hugeSelections }),
    ];
    // encodeCompareDeepLink itself does not validate catalog ids — only create checks length.
    const encoded = encodeCompareDeepLink(input);
    const path = "/compare/";
    const fakeUrl = `https://example.test${path}?${COMPARE_DEEP_LINK_QUERY_PARAM}=${encoded}`;
    expect(fakeUrl.length).toBeGreaterThan(COMPARE_DEEP_LINK_MAX_URL_LENGTH);

    const result = createCompareDeepLinkUrl("https://example.test", "/compare", input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("too_long");
    expect(result.message).toMatch(/too long to share/i);
    expect(result.length).toBeGreaterThan(COMPARE_DEEP_LINK_MAX_URL_LENGTH);
  });

  it("rejects invalid build counts and malformed payloads", () => {
    expect(() => encodeCompareDeepLink([])).toThrow(ApiError);
    expect(() =>
      encodeCompareDeepLink([
        build({ vehicleId: "4runner", gradeId: "trd-pro", selections: {} }),
      ]),
    ).toThrow(/2–4 builds/);

    expect(() => decodeCompareDeepLink("%%%")).toThrow(ApiError);
    const crafted = Buffer.from(JSON.stringify({ v: 99, b: [{}, {}] }), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(() => decodeCompareDeepLink(crafted)).toThrow(/Unsupported compare deep-link schema version/);

    const countResult = createCompareDeepLinkUrl("https://example.test", "/compare", [
      build({ vehicleId: "4runner", gradeId: "trd-pro", selections: {} }),
    ]);
    expect(countResult.ok).toBe(false);
    if (countResult.ok) return;
    expect(countResult.reason).toBe("invalid_count");
  });

  it("rejects unknown option ids via catalog validation", () => {
    const encoded = encodeCompareDeepLink([
      build({
        vehicleId: "4runner",
        gradeId: "trd-pro",
        selections: { paint: ["paint-does-not-exist"] },
      }),
      build({ vehicleId: "tacoma", gradeId: "sr", selections: {} }),
    ]);
    expect(() => validateCompareDeepLink(encoded)).toThrow(/Unknown option id/);
  });

  it("does not put GLB node names into the encoded payload", () => {
    const encoded = encodeCompareDeepLink([
      build({
        vehicleId: "4runner",
        gradeId: "trd-pro",
        selections: { paint: ["paint-3u5-barcelona-red"] },
      }),
      build({
        vehicleId: "ae86",
        gradeId: "gt-s",
        modelYear: 1985,
        selections: { paint: ["paint-3p0-classic-red"] },
      }),
    ]);
    const json = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/") + "==", "base64").toString(
      "utf8",
    );
    expect(json).not.toMatch(/BODY|body\.carmain|MOUNT_/);
    expect(json).toContain("paint-3u5-barcelona-red");
  });

  it("buildsToCompareDeepLinkInput maps configuration fields", () => {
    expect(
      buildsToCompareDeepLinkInput([
        {
          vehicleId: "4runner",
          modelYear: 2024,
          gradeId: "trd-pro",
          selections: { paint: ["paint-1j9-ice-cap"] },
        },
      ]),
    ).toEqual([
      {
        vehicleId: "4runner",
        modelYear: 2024,
        gradeId: "trd-pro",
        selections: { paint: ["paint-1j9-ice-cap"] },
      },
    ]);
  });
});
