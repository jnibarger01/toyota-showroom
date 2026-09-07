import gsap from "gsap";
import type { CameraPresetConfig } from "../types/vehicle";
import { motionDuration } from "./motionPreference";

/**
 * Preferred cinematic path: hero establishing shot → wheels close-up → interior/cabin framing.
 * Catalogs that author these `presetId`s get that path; otherwise the tour walks every preset
 * in catalog order so a vehicle without the named shots still has a playable sequence.
 */
export const TOUR_PRESET_IDS = ["hero", "wheels", "interior"] as const;

export type TourStatus = "idle" | "playing" | "paused";

export type CinematicTourCallbacks = {
  onStatusChange?: (status: TourStatus) => void;
  onStep?: (preset: CameraPresetConfig, index: number) => void;
  onComplete?: () => void;
  onCancel?: () => void;
};

/** Mutable position/target objects GSAP can tween (Three.js Vector3 satisfies this). */
export type TourVec3 = { x: number; y: number; z: number };

export type CinematicTourTargets = {
  cameraPosition: TourVec3;
  cameraTarget: TourVec3;
  /** Tour seizes OrbitControls while playing/paused so GSAP is the sole writer. */
  setControlsEnabled: (enabled: boolean) => void;
  /** Canvas element — pointer/wheel here cancels the tour so manual orbit never fights GSAP. */
  domElement?: HTMLElement | null;
};

export type CinematicTour = {
  play(): void;
  pause(): void;
  cancel(): void;
  dispose(): void;
  readonly status: TourStatus;
  setPresets(presets: readonly CameraPresetConfig[]): void;
};

/** Seconds per camera move and per rest between shots (collapsed to 0 under reduced motion). */
const STEP_DURATION_SECONDS = 1.6;
const HOLD_DURATION_SECONDS = 0.55;

/**
 * Picks the hero → wheels → interior path when at least two of those ids exist; otherwise the
 * full catalog list. A single matching id is not enough — a one-stop "tour" is just a preset
 * click, and falling back keeps Play useful on thin catalogs.
 */
export function resolveTourPresets(presets: readonly CameraPresetConfig[]): CameraPresetConfig[] {
  const byId = new Map(presets.map((preset) => [preset.id, preset]));
  const preferred = TOUR_PRESET_IDS.map((id) => byId.get(id)).filter(
    (preset): preset is CameraPresetConfig => preset !== undefined,
  );
  if (preferred.length >= 2) return preferred;
  return presets.slice();
}

/**
 * GSAP timeline over camera position + orbit target, sequenced from catalog presets.
 *
 * ## Orbit hand-off
 *
 * While playing or paused, OrbitControls is disabled so damping/drag cannot write the same
 * vectors GSAP is tweening. Pointer-down or wheel on the canvas cancels the tour, re-enables
 * controls, and leaves the camera where it stopped — so a cancelled tour never "fights" the user.
 * Pause keeps controls seized so Resume continues the same timeline; Cancel (or an interrupt)
 * is the explicit hand-back.
 */
export function createCinematicTour(
  targets: CinematicTourTargets,
  initialPresets: readonly CameraPresetConfig[],
  callbacks: CinematicTourCallbacks = {},
): CinematicTour {
  let presets = resolveTourPresets(initialPresets);
  let status: TourStatus = "idle";
  let timeline: gsap.core.Timeline | null = null;

  const setStatus = (next: TourStatus) => {
    status = next;
    callbacks.onStatusChange?.(next);
  };

  const killCameraTweens = () => {
    gsap.killTweensOf(targets.cameraPosition);
    gsap.killTweensOf(targets.cameraTarget);
  };

  const releaseControls = () => {
    targets.setControlsEnabled(true);
  };

  const seizeControls = () => {
    targets.setControlsEnabled(false);
  };

  const buildTimeline = (): gsap.core.Timeline => {
    killCameraTweens();
    if (timeline) {
      timeline.kill();
      timeline = null;
    }

    const tl = gsap.timeline({
      paused: true,
      onComplete: () => {
        timeline = null;
        releaseControls();
        setStatus("idle");
        callbacks.onComplete?.();
      },
    });

    presets.forEach((preset, index) => {
      const duration = motionDuration(STEP_DURATION_SECONDS);
      const hold = motionDuration(HOLD_DURATION_SECONDS);

      tl.call(() => {
        callbacks.onStep?.(preset, index);
      });

      // Position and target move together ("<") so the look-at stays locked to the shot.
      tl.to(targets.cameraPosition, {
        x: preset.position[0],
        y: preset.position[1],
        z: preset.position[2],
        duration,
        ease: "power3.inOut",
      });
      tl.to(
        targets.cameraTarget,
        {
          x: preset.target[0],
          y: preset.target[1],
          z: preset.target[2],
          duration,
          ease: "power3.inOut",
        },
        "<",
      );

      if (hold > 0) {
        tl.to({}, { duration: hold });
      }
    });

    timeline = tl;
    return tl;
  };

  const onUserInterrupt = () => {
    if (status === "playing" || status === "paused") {
      cancel();
    }
  };

  const dom = targets.domElement ?? null;
  if (dom) {
    dom.addEventListener("pointerdown", onUserInterrupt);
    dom.addEventListener("wheel", onUserInterrupt, { passive: true });
  }

  function play(): void {
    if (presets.length === 0) return;

    if (status === "paused" && timeline) {
      seizeControls();
      timeline.play();
      setStatus("playing");
      return;
    }

    seizeControls();
    const tl = buildTimeline();
    setStatus("playing");
    tl.play();
  }

  function pause(): void {
    if (status !== "playing" || !timeline) return;
    timeline.pause();
    setStatus("paused");
  }

  function cancel(): void {
    if (status === "idle" && !timeline) return;
    const wasActive = status !== "idle";
    if (timeline) {
      timeline.kill();
      timeline = null;
    }
    killCameraTweens();
    releaseControls();
    setStatus("idle");
    if (wasActive) callbacks.onCancel?.();
  }

  function dispose(): void {
    cancel();
    if (dom) {
      dom.removeEventListener("pointerdown", onUserInterrupt);
      dom.removeEventListener("wheel", onUserInterrupt);
    }
  }

  return {
    play,
    pause,
    cancel,
    dispose,
    get status() {
      return status;
    },
    setPresets(next) {
      presets = resolveTourPresets(next);
    },
  };
}
