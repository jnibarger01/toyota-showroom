import { describe, expect, it } from "vitest";
import { encodeBuildDeepLink, readBuildDeepLinkParam } from "../lib/showroom/deepLink";
import { createShareQrEncodedPayload, createShareQrUrl } from "../lib/showroom/shareQr";
import type { CameraState, SelectionMap } from "../lib/types/customization";

const heroCamera: CameraState = {
  presetId: "hero",
  position: [7.5, 4.0, 8.5],
  target: [0, 1.1, 0],
};

describe("share QR payload (#50)", () => {
  const selections: SelectionMap = {
    paint: ["paint-3u5-barcelona-red"],
    wheels: ["wheels-weisu-bronze"],
  };
  const input = {
    gradeId: "trd-pro",
    selections,
    cameraState: heroCamera,
  };

  it("QR encoded payload equals encodeBuildDeepLink output", () => {
    expect(createShareQrEncodedPayload(input)).toBe(encodeBuildDeepLink(input));
  });

  it("QR URL carries the same c= value as encodeBuildDeepLink (Share deep link)", () => {
    const url = createShareQrUrl("https://example.test", "/4runner/", input);
    expect(url.startsWith("https://example.test/4runner/?c=")).toBe(true);
    const encoded = readBuildDeepLinkParam(new URL(url).search);
    expect(encoded).toBe(encodeBuildDeepLink(input));
  });

  it("QR payload has no GLB node names", () => {
    const encoded = createShareQrEncodedPayload(input);
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padLength = (4 - (padded.length % 4)) % 4;
    const json = Buffer.from(padded + "=".repeat(padLength), "base64").toString("utf8");
    expect(json).not.toMatch(/BODY|body\.carmain|MOUNT_/);
    expect(json).toContain("paint-3u5-barcelona-red");
    expect(json).toContain("wheels-weisu-bronze");
  });

  it("works for local/demo-style absolute paths without Worker share-card", () => {
    const url = createShareQrUrl("http://127.0.0.1:3000", "/toyota-showroom/4runner/", {
      gradeId: "trd-pro",
      selections: { paint: ["paint-1j9-ice-cap"] },
    });
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:3000\/toyota-showroom\/4runner\/\?c=/);
    expect(url).not.toMatch(/share-card/);
    expect(readBuildDeepLinkParam(new URL(url).search)).toBe(
      encodeBuildDeepLink({
        gradeId: "trd-pro",
        selections: { paint: ["paint-1j9-ice-cap"] },
      }),
    );
  });
});
