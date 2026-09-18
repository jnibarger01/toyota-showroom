import { describe, expect, it } from "vitest";
import {
  XR_ENTER_LABEL,
  XR_EXIT_LABEL,
  XR_PENDING_MESSAGE,
  XR_UNSUPPORTED_MESSAGE,
  describeXrCapability,
  xrControlEnabled,
  xrControlLabel,
} from "../lib/three/xrCapability";

describe("xrCapability messaging", () => {
  it("explains pending and unsupported without throwing", () => {
    expect(describeXrCapability("pending")).toBe(XR_PENDING_MESSAGE);
    expect(describeXrCapability("unsupported")).toBe(XR_UNSUPPORTED_MESSAGE);
    expect(describeXrCapability("supported")).toBeNull();
  });

  it("enables the control only when immersive-ar is available", () => {
    expect(xrControlEnabled("pending")).toBe(false);
    expect(xrControlEnabled("unsupported")).toBe(false);
    expect(xrControlEnabled("supported")).toBe(true);
  });

  it("swaps enter/exit labels from presenting state", () => {
    expect(xrControlLabel(false)).toBe(XR_ENTER_LABEL);
    expect(xrControlLabel(true)).toBe(XR_EXIT_LABEL);
  });
});
