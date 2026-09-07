// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { motionDuration, prefersReducedMotion } from "../lib/three/motionPreference";

/** Installs a `matchMedia` stub reporting the given reduced-motion preference. */
function stubMatchMedia(reduced: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("prefers-reduced-motion: reduce") ? reduced : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prefersReducedMotion", () => {
  it("reports the user's preference", () => {
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);

    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("returns false when matchMedia is unavailable", () => {
    // A browser that cannot express the preference has not expressed it. Every call site is inside
    // a client-only effect where the real value is available by the time it matters, so this only
    // has to not throw during server render or in a bare test environment.
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("re-reads the preference on every call", () => {
    // The preference can change mid-session — a user toggles it precisely *because* a page is
    // making them ill — and a value cached at mount would ignore that until reload.
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe("motionDuration", () => {
  it("passes durations through when motion is fine", () => {
    stubMatchMedia(false);
    expect(motionDuration(0.85)).toBe(0.85);
  });

  it("collapses to exactly zero under reduced motion", () => {
    // Zero, not a small non-zero value: GSAP treats a zero duration as an immediate set, so the
    // tween's onComplete still fires and the end state is reached through the same code path. A
    // 0.01s "nearly instant" duration would look identical but silently change that guarantee —
    // and the proxy cross-fade disposes geometry in onComplete.
    stubMatchMedia(true);
    expect(motionDuration(0.85)).toBe(0);
    expect(motionDuration(0.35)).toBe(0);
  });
});

/**
 * Source-level guard on the call sites, for the same reason `tests/progressiveLoad.test.ts` has
 * one: jsdom cannot render `VehicleCanvas`, so behavioural coverage of the stage is unavailable.
 * The realistic regression is not that `motionDuration` breaks — it is that someone adds a fifth
 * animation and passes a raw number, and nothing notices.
 */
describe("VehicleCanvas animation call sites", () => {
  const source = readFileSync(path.join(process.cwd(), "app/components/VehicleCanvas.tsx"), "utf8");

  it("routes every gsap duration through motionDuration", () => {
    // Matches `duration: <literal>` — the shape a new animation is written in before anyone
    // remembers the preference exists. `duration,` (the shared local) and `motionDuration(...)`
    // both pass.
    const rawDurations = source.match(/duration:\s*[\d.]+/g) ?? [];
    expect(
      rawDurations,
      "A gsap duration is hard-coded instead of passing through motionDuration(). Users who ask " +
        "for reduced motion get the animation anyway.",
    ).toEqual([]);
  });

  it("routes cinematic tour gsap durations through motionDuration", () => {
    const tourSource = readFileSync(path.join(process.cwd(), "lib/three/cinematicTour.ts"), "utf8");
    const rawDurations = tourSource.match(/duration:\s*[\d.]+/g) ?? [];
    expect(
      rawDurations,
      "cinematicTour: a gsap duration is hard-coded instead of passing through motionDuration().",
    ).toEqual([]);
    expect(tourSource).toContain("motionDuration(");
  });

  it("makes damping conditional on the preference", () => {
    // Damping is inertia — the scene keeps moving after the user stops dragging — which is exactly
    // the motion the preference covers, and it is not a gsap tween so the check above misses it.
    expect(source).toContain("controls.enableDamping = !prefersReducedMotion()");
  });
});

/** The 3D stage was pointer-only before this; these are the pieces that put it in the tab order. */
describe("VehicleCanvas keyboard access", () => {
  const source = readFileSync(path.join(process.cwd(), "app/components/VehicleCanvas.tsx"), "utf8");

  it("makes the stage focusable and labelled", () => {
    expect(source).toContain("tabIndex={0}");
    expect(source).toContain("aria-label");
  });

  it("binds orbit, zoom, and reset keys", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"]) {
      expect(source, `no keyboard handling for ${key}`).toContain(`case "${key}"`);
    }
  });

  it("leaves modified key combinations to the browser", () => {
    // Stealing Cmd/Ctrl+arrow from a keyboard user is a worse bug than the one this fixes.
    expect(source).toContain("if (event.altKey || event.ctrlKey || event.metaKey) return;");
  });
});
