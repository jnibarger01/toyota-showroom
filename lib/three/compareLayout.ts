/**
 * Layout math for the side-by-side 3D compare stage (`app/components/CompareStage.tsx`), kept free of
 * WebGL so it can be tested directly.
 *
 * One canvas, one renderer, one camera, N scissored viewports. The alternative — one canvas per
 * vehicle — costs a WebGL context each, and browsers cap live contexts (Chrome at 16, some mobile
 * GPUs far lower); losing one mid-comparison blanks a column with no error. A single context also
 * means the shared environment map and shader programs are uploaded once, not N times.
 */

export interface Viewport {
  /** CSS pixels from the canvas's left/bottom edge — WebGL's scissor origin is bottom-left. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Equal columns with a hairline gap, covering the whole canvas height. */
export function columnViewports(count: number, width: number, height: number, gap = 2): Viewport[] {
  if (count <= 0) return [];
  const columnWidth = Math.max(1, Math.floor((width - gap * (count - 1)) / count));
  return Array.from({ length: count }, (_, index) => ({
    x: index * (columnWidth + gap),
    y: 0,
    width: columnWidth,
    height,
  }));
}

/**
 * Camera distance that fits the *largest* vehicle in a column. Every column shares one camera, so
 * sizing to the largest keeps the biggest vehicle in frame and — the point of the feature — lets the
 * smaller ones read as smaller rather than each being zoomed to fill its own column.
 */
export function fitDistance(largestRadius: number, verticalFovDegrees: number, columnAspect: number): number {
  const vertical = (verticalFovDegrees * Math.PI) / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * columnAspect);
  const limiting = Math.min(vertical, horizontal);
  return (largestRadius * 1.15) / Math.sin(limiting / 2);
}

/** Whether to offer the 3D stage: wide enough for columns, WebGL2 present, and not on Save-Data. */
export function canOfferCompare3d(env: { width: number; hasWebGL2: boolean; saveData: boolean }): boolean {
  return env.width >= 900 && env.hasWebGL2 && !env.saveData;
}

/** Vehicles the 3D stage can actually show: those that ship a model. */
export function withCompareModels<V extends { threeDConfig: { hasModel?: boolean; modelUrl?: string } }>(vehicles: readonly V[]): V[] {
  return vehicles.filter((vehicle) => vehicle.threeDConfig.hasModel && vehicle.threeDConfig.modelUrl);
}

/**
 * A comparison needs something to compare: with fewer than two modelled vehicles the stage would be
 * a one-car "comparison" labelled "at true relative scale", so it is not offered at all.
 */
export const COMPARE_3D_MIN_MODELS = 2;

export type CompareKeyAction = { kind: "orbit"; theta: number; phi: number } | { kind: "zoom"; factor: number } | { kind: "reset" };

/** Radians per arrow-key press; small enough to aim, large enough that a held key moves briskly. */
export const COMPARE_KEY_ORBIT_STEP = Math.PI / 24;

/**
 * Keyboard equivalents of the stage's pointer controls, matching the builder viewer's scheme:
 * arrows orbit, plus/minus zoom, Home re-frames. `null` for keys the stage leaves alone (Tab, etc.).
 */
export function compareKeyAction(key: string): CompareKeyAction | null {
  switch (key) {
    case "ArrowLeft":
      return { kind: "orbit", theta: -COMPARE_KEY_ORBIT_STEP, phi: 0 };
    case "ArrowRight":
      return { kind: "orbit", theta: COMPARE_KEY_ORBIT_STEP, phi: 0 };
    case "ArrowUp":
      return { kind: "orbit", theta: 0, phi: -COMPARE_KEY_ORBIT_STEP };
    case "ArrowDown":
      return { kind: "orbit", theta: 0, phi: COMPARE_KEY_ORBIT_STEP };
    case "+":
    case "=":
      return { kind: "zoom", factor: 0.9 };
    case "-":
    case "_":
      return { kind: "zoom", factor: 1 / 0.9 };
    case "Home":
      return { kind: "reset" };
    default:
      return null;
  }
}
