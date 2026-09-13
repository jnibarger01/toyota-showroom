import { describe, expect, it } from "vitest";
import { describeTourScene } from "../lib/showroom/tourAnnouncement";

describe("describeTourScene", () => {
  it("names the catalog label so SR hears the scene, not the preset id", () => {
    expect(describeTourScene({ label: "Hero" })).toBe("Tour scene: Hero.");
    expect(describeTourScene({ label: "Wheels" })).toBe("Tour scene: Wheels.");
    expect(describeTourScene({ label: "Interior" })).toBe("Tour scene: Interior.");
  });
});
