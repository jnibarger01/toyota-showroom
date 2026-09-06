import { describe, expect, it } from "vitest";
import {
  qualitySettingsFor,
  resolveQuality,
  selectQualityTier,
  type DeviceHints,
} from "../lib/three/quality";

describe("selectQualityTier", () => {
  it("honours an explicit preferTier override", () => {
    expect(selectQualityTier({ preferTier: "low", deviceMemoryGb: 32 })).toBe("low");
  });

  it("forces low when Save-Data is on", () => {
    expect(selectQualityTier({ saveData: true, deviceMemoryGb: 16 })).toBe("low");
  });

  it("maps very low device memory to low", () => {
    expect(selectQualityTier({ deviceMemoryGb: 2 })).toBe("low");
  });

  it("maps mid device memory to medium", () => {
    expect(selectQualityTier({ deviceMemoryGb: 4, hardwareConcurrency: 8 })).toBe("medium");
  });

  it("maps mobile user agents to medium when memory is ample", () => {
    expect(
      selectQualityTier({
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        deviceMemoryGb: 8,
        hardwareConcurrency: 6,
      }),
    ).toBe("medium");
  });

  it("maps coarse touch devices to medium", () => {
    expect(selectQualityTier({ maxTouchPoints: 5, hardwareConcurrency: 8 })).toBe("medium");
  });

  it("defaults desktop-class devices to high", () => {
    const hints: DeviceHints = {
      deviceMemoryGb: 16,
      hardwareConcurrency: 12,
      maxTouchPoints: 0,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
      devicePixelRatio: 2,
    };
    expect(selectQualityTier(hints)).toBe("high");
  });

  it("caps high-DPR desktops at medium", () => {
    expect(
      selectQualityTier({
        deviceMemoryGb: 16,
        hardwareConcurrency: 12,
        maxTouchPoints: 0,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
        devicePixelRatio: 3,
      }),
    ).toBe("medium");
  });
});

describe("qualitySettingsFor / resolveQuality", () => {
  it("exposes distinct LOD knobs per tier", () => {
    const high = qualitySettingsFor("high");
    const medium = qualitySettingsFor("medium");
    const low = qualitySettingsFor("low");

    expect(high.maxPixelRatio).toBeGreaterThan(medium.maxPixelRatio);
    expect(medium.maxPixelRatio).toBeGreaterThan(low.maxPixelRatio);
    expect(high.shadowMapSize).toBeGreaterThan(medium.shadowMapSize);
    expect(medium.shadowsEnabled).toBe(true);
    expect(low.shadowsEnabled).toBe(false);
    expect(low.antialias).toBe(false);
    expect(low.loadAuthoredRunningGear).toBe(false);
    expect(high.loadAuthoredRunningGear).toBe(true);
  });

  it("resolveQuality composes selection and settings", () => {
    const settings = resolveQuality({ preferTier: "medium" });
    expect(settings.tier).toBe("medium");
    expect(settings.shadowMapSize).toBe(1024);
  });
});
