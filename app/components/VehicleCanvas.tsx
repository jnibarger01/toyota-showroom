"use client";

/**
 * React orchestration layer for the 3D showroom. What used to be a single ~700-line setup effect
 * owning a dozen scattered `let`s now constructs and wires four independently-owned authorities —
 * `RenderController` (Priority 6: renderer/render-loop/quality/context-loss), `CameraController`
 * (Priority 3: camera/controls/tour), `EnvironmentController` (Priority 5: lighting/terrain/HDRI),
 * and `VehicleSceneController` (Priority 1: scene graph/picking/selection, constructed once the
 * GLB resolves) — and translates their events into the React props this component was handed:
 * `onReady`, `onError`, `onProgress`, `onPartHover`, `onPartSelect`, `onTourStatusChange`,
 * `onTourStep`. Construction is a short, explicit, linear sequence (`RenderController.create()` →
 * `CameraController` → `EnvironmentController` → `attachScene`/`resize`/`start`); disposal is the
 * same sequence in reverse, in one `cleanup` closure.
 *
 * ## Why there is no `SceneRuntime` composition root (Priority 7)
 *
 * The mission scoped Priority 7 as conditional: a composition root only if one "solves real
 * coordination problems," never "a dumping ground." It doesn't, here. The three-line construction
 * order above is not duplicated anywhere, is not error-prone (each controller's constructor takes
 * exactly what it owns — a canvas, a scene, a quality snapshot — not a live reference to a sibling
 * controller), and disposal already reads as a flat list. Wrapping those three lines in a class
 * would not remove coordination logic; it would relocate it and add an indirection every reader has
 * to look through to find the same three calls.
 *
 * What is left in this file after Priorities 3/5/6 — pointer/keyboard DOM event handling, the
 * progressive-load state machine, part hover/select, the cinematic-tour keyboard shortcuts — is not
 * spare renderer/camera/environment coordination looking for a home. It is this component's actual
 * job: translating DOM and scene events into the React callback props above. None of it can move
 * into a plain, renderer-agnostic class without smuggling application state (React props, callback
 * closures) into the Three.js module layer, which is exactly the boundary `CameraController`/
 * `EnvironmentController`/`RenderController` were each built to hold ("no application-state or
 * agent-layer dependency" — every one of their own doc comments says this). A `SceneRuntime` that
 * owned pointer handling to justify its own existence would be the dumping ground the mission named
 * as the failure mode, not a fix for one.
 */

import { useEffect, useRef, useState } from "react";
import { CanvasModelStatus, type CanvasModelStatusKind } from "./CanvasModelStatus";
import gsap from "gsap";
import * as THREE from "three";
import type { Vehicle3DConfig } from "../../lib/types/vehicle";
import type { CustomizationOption } from "../../lib/types/customization";
import { VehicleSceneController } from "../../lib/three/sceneController";
import { getGltfLoader, instantiateAsset, loadAsset, disposeSubtree } from "../../lib/three/assets";
import { resolveAssetUrl } from "../../lib/three/assetUrl";
import { findNodeByName, logHierarchy, verifyNodeContract } from "../../lib/three/nodes";
import { worldBoundsOf } from "../../lib/three/showroomFrame";
import { getSceneMapForVehicle } from "../../lib/data/sceneMap";
import { pointerToNdc } from "../../lib/three/picking";
import type { SceneRegistryEntry } from "../../lib/three/sceneRegistry";
import { buildProceduralAccessories, createProceduralVehicle } from "../../lib/three/proceduralParts";
import { installProceduralWheelPackages } from "../../lib/three/installWheels";
import { buildRuntimeModificationKit } from "../../lib/three/proceduralMods";
import {
  initialProgressiveState,
  reduceProgressiveLoad,
} from "../../lib/three/progressiveLoad";
import { motionDuration } from "../../lib/three/motionPreference";
import type { TourStatus } from "../../lib/three/cinematicTour";
import { CameraController, KEYBOARD_ORBIT_STEP_RADIANS, KEYBOARD_ZOOM_STEP } from "../../lib/three/cameraController";
import {
  EnvironmentController,
  type Terrain,
  type EnvironmentPreset,
} from "../../lib/three/environmentController";
import { RenderController } from "../../lib/three/renderController";
import { FloorReflection } from "../../lib/three/floorReflection";
import { FrontWheelSteer, steerAngleForPreset } from "../../lib/three/steering";
import type { LampMode } from "../../lib/three/vehicleLights";
import { DoorRig } from "../../lib/three/doors";
import { driverEyeFromSteeringWheel } from "../../lib/three/interiorView";
import { buildDimensionsOverlay, disposeDimensionsOverlay, type DimensionLabel, type DimensionSpec } from "../../lib/three/dimensions";
import { projectToScreen, resolveHotspotAnchor, selectHotspots, surfaceSamples, type Hotspot } from "../../lib/three/hotspots";
import type { CustomizationCategory } from "../../lib/types/customization";
import { prefersReducedMotion } from "../../lib/three/motionPreference";
import { modelUrlForDetail, type QualitySettings } from "../../lib/three/quality";
import { createPrefetchScheduler, prefetchBudgetForTier, type PrefetchScheduler } from "../../lib/three/prefetch";
import { XrSessionController } from "../../lib/three/xrSession";
import { readQualityPreference, writeQualityPreference, type QualityPreference } from "../../lib/three/qualityPreference";
import { prefetchHdriPreset } from "../../lib/three/hdriEnvironment";
import { DEFAULT_HDRI_PRESET_ID, HDRI_PRESETS } from "../../lib/data/paintStudio";
import { installMetricsFlush, recordMetric } from "../../lib/observability/clientMetrics";

export type { Terrain, EnvironmentPreset };

export type { TourStatus };
export type TourAction = { seq: number; type: "play" | "pause" | "cancel" };

export type CameraPreset = {
  id: string;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
};

type Props = {
  threeDConfig: Vehicle3DConfig;
  /** Vehicle catalog slug — resolves the semantic scene map (`lib/data/sceneMap`) the controller
   * builds its `SceneRegistry` from. A slug with no map yields a controller with no addressable
   * parts, the same graceful-empty behaviour `buildSceneRegistry` gives any partial map. */
  slug: string;
  /** Full server catalog. Only the options this GLB can satisfy are handed back via `onReady`. */
  catalog: CustomizationOption[];
  cameraPreset: CameraPreset;
  /** Ride-height offset in inches; not a catalog category, so it stays a plain prop. */
  lift: number;
  terrain: Terrain;
  environmentPreset: EnvironmentPreset;
  /** Catalog HDRI preset id from paint studio — resolved server-side, never a raw URL. */
  hdriPresetId?: string;
  /**
   * Fired once the model is loaded, cleaned up, and verified. The controller is the caller's
   * handle for every subsequent scene mutation — the canvas itself never applies an option.
   */
  onReady: (controller: VehicleSceneController, applicable: CustomizationOption[]) => void;
  onError: (message: string) => void;
  /**
   * Download progress for the main vehicle asset, 0..1. Optional, and deliberately not a substitute
   * for `onReady`: the placeholder is already on screen while this fires, so it drives a progress
   * affordance rather than a blocking spinner.
   *
   * Only reported when the server sends `Content-Length`. A Draco GLB served with
   * `Content-Encoding: gzip` often does not, and inventing a percentage is worse than showing none.
   */
  onProgress?: (fraction: number) => void;
  /**
   * Imperative tour command from builder chrome. Each click bumps `seq` so play→pause→play
   * replays even when `type` repeats. The canvas owns the GSAP timeline; the parent only
   * mirrors status for the Play/Pause control.
   */
  tourAction?: TourAction | null;
  /**
   * Bumped by the chrome's "Recenter view" control to re-frame the active preset.
   *
   * Named "recenter", not "reset", because the sidebar already has a Reset that discards the whole
   * build. Two controls a few hundred pixels apart both called Reset, one moving the camera and one
   * throwing away the configuration, is a mistake waiting to happen.
   *
   * A counter rather than a boolean or a preset object, for the same reason `tourAction` carries a
   * `seq`: resetting twice in a row is a legitimate thing to ask for, and re-sending an unchanged
   * value would make the second request a no-op. This is the pointer-driven equivalent of the Home
   * key, which reaches the same `resetToPreset` directly.
   */
  resetViewSignal?: number;
  /**
   * Bumped by the chrome's "View in AR" control to enter an immersive-AR session. Counter for the
   * same reason as `resetViewSignal`: re-entering after exiting is a legitimate repeat request.
   */
  enterXrSignal?: number;
  /**
   * Bumped by the chrome's "Exit AR" control. Same counter pattern as `enterXrSignal` — ending from
   * the builder must work even when the headset's own exit control is not in reach (phone browsers
   * often leave the page chrome visible while presenting).
   */
  exitXrSignal?: number;
  /**
   * Viewer's quality choice. `"auto"` hands the tier back to `QualityGovernor`; anything else pins
   * it, suspending automatic adaptation — see `lib/three/qualityPreference.ts` for why a pinned
   * tier turns the governor off rather than merely seeding it.
   */
  qualityPreference?: QualityPreference;
  /** Reports the stored preference once the renderer exists, so the chrome can show the real value
   * rather than assuming a default the viewer may have changed on a previous visit. */
  onQualityPreferenceLoaded?: (preference: QualityPreference) => void;
  /** True when the live renderer cannot honour the current choice in full — `antialias` and authored
   * running gear are construction-time only. Lets the chrome say so instead of implying the tier is
   * fully active. */
  onQualityNeedsReload?: (needsReload: boolean) => void;
  /** Reports whether this device can offer AR at all, so the chrome can show a disabled control
   * with unsupported-device messaging rather than one that fails on tap. */
  onXrSupported?: (supported: boolean) => void;
  /** Reports session start/end so the chrome can swap enter ↔ exit on the same control. */
  onXrPresentingChange?: (presenting: boolean) => void;
  /**
   * XR-only failures (unsupported hardware after a tap, declined camera permission). Kept distinct
   * from `onError` so a refused AR prompt cannot look like a broken vehicle load.
   */
  onXrError?: (message: string) => void;
  onTourStatusChange?: (status: TourStatus) => void;
  /** Fired as each catalog preset becomes the tour's current shot (toolbar highlight + cameraState). */
  onTourStep?: (preset: CameraPreset) => void;
  /**
   * Fired on every hover change over a semantically-addressable part (`undefined` when the
   * pointer/keyboard cursor leaves one). Mirrors `VehicleSceneController.hoveredPartId`, which the
   * canvas already drives — this is how the surrounding configurator chrome finds out without
   * polling the controller or touching `THREE.Object3D` itself.
   */
  onPartHover?: (part: SceneRegistryEntry | undefined) => void;
  /** Fired on every selection change — a part click/tap/Enter, or a click on empty space/Escape clearing it. */
  onPartSelect?: (part: SceneRegistryEntry | undefined) => void;
  /** Lamp state (`lib/three/vehicleLights.ts`). Scene-only, like the camera — not part of the build. */
  lampMode?: LampMode;
  /** Reports which lamp modes this vehicle's scene map can actually show, once it settles; `[]` hides
   * the control. */
  onLampModesAvailable?: (modes: LampMode[]) => void;
  /** Feature hotspots (`lib/three/hotspots.ts`) for these catalog categories; empty/omitted = none. */
  hotspotCategories?: readonly CustomizationCategory[];
  showHotspots?: boolean;
  /** A hotspot was activated — the chrome opens `category`. */
  onHotspotActivate?: (category: CustomizationCategory) => void;
  /** Dimensions overlay (`lib/three/dimensions.ts`), labelled with these catalog figures. */
  showDimensions?: boolean;
  dimensionSpecs?: readonly DimensionSpec[];
  /** Opens every door/lid the vehicle models separately (`threeDConfig.doors`). */
  doorsOpen?: boolean;
  onDoorsAvailable?: (available: boolean) => void;
  /** Driver's-seat camera (`lib/three/interiorView.ts`). */
  driverView?: boolean;
  onDriverViewAvailable?: (available: boolean) => void;
  /** The view left the seat on its own (a camera preset, Home) — the chrome should un-toggle. */
  onDriverViewExit?: () => void;
};

export function VehicleCanvas({ threeDConfig, slug, catalog, cameraPreset, lift, terrain, environmentPreset, hdriPresetId, onReady, onError, onProgress, tourAction, resetViewSignal, enterXrSignal, exitXrSignal, onXrSupported, onXrPresentingChange, onXrError, qualityPreference, onQualityPreferenceLoaded, onQualityNeedsReload, onTourStatusChange, onTourStep, onPartHover, onPartSelect, lampMode, onLampModesAvailable, hotspotCategories, showHotspots = false, onHotspotActivate, showDimensions = false, dimensionSpecs, doorsOpen = false, onDoorsAvailable, driverView = false, onDriverViewAvailable, onDriverViewExit }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cameraControllerRef = useRef<CameraController | null>(null);
  /** True while the cinematic tour owns the camera — suppresses the preset-change GSAP effect. */
  const tourActiveRef = useRef(false);
  const rootRef = useRef<THREE.Object3D | null>(null);
  /** Grounded `position.y` from `prepareVehicleRoot`; lift is applied relative to it. */
  const groundedYRef = useRef(0);
  /**
   * Bumped once the model is in the scene. The lift effect depends on it so the initial ride height
   * is applied when the root appears — otherwise the effect runs only while the 39 MB GLB is still
   * loading, finds no root, and never reruns because `lift` itself has not changed.
   */
  const [sceneRevision, setSceneRevision] = useState(0);
  /**
   * Asset-path empty/error notice (#75). Distinct from CanvasErrorBoundary: this covers GLB
   * fetch/decode failure (and vehicles with no detailed model), not React render crashes.
   */
  const [modelStatus, setModelStatus] = useState<CanvasModelStatusKind | null>(null);
  /** Bumped by Retry so the setup effect remounts and re-fetches the GLB. */
  const [loadAttempt, setLoadAttempt] = useState(0);
  const environmentControllerRef = useRef<EnvironmentController | null>(null);
  const renderControllerRef = useRef<RenderController | null>(null);

  // Latest-value refs: the setup effect must run exactly once (loading a 39 MB GLB again on every
  // prop change is the thing this integration exists to avoid), so it reads callbacks through refs
  // rather than listing them as dependencies. The assignment happens in an effect, not inline during
  // render — writing to `ref.current` while rendering is an impure side effect React disallows (the
  // render function may run more than once before committing); an effect runs only after commit.
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const onProgressRef = useRef(onProgress);
  const catalogRef = useRef(catalog);
  const onTourStatusChangeRef = useRef(onTourStatusChange);
  const onTourStepRef = useRef(onTourStep);
  const onPartHoverRef = useRef(onPartHover);
  const onPartSelectRef = useRef(onPartSelect);
  // Read by the Home-key handler, which lives in the run-once setup effect and so cannot close over
  // the prop directly — it would reset to whichever preset was active at mount.
  const cameraPresetRef = useRef(cameraPreset);
  const onXrSupportedRef = useRef(onXrSupported);
  const onXrPresentingChangeRef = useRef(onXrPresentingChange);
  const onXrErrorRef = useRef(onXrError);
  const onQualityPreferenceLoadedRef = useRef(onQualityPreferenceLoaded);
  const qualityPreferenceRef = useRef(qualityPreference);
  const onQualityNeedsReloadRef = useRef(onQualityNeedsReload);
  const xrControllerRef = useRef<XrSessionController | null>(null);
  /** The settled vehicle's scene controller, for effects outside the setup closure (lamp mode). */
  const sceneControllerRef = useRef<VehicleSceneController | null>(null);
  const steerRef = useRef<FrontWheelSteer | null>(null);
  const lampModeRef = useRef(lampMode);
  const onLampModesAvailableRef = useRef(onLampModesAvailable);
  const doorRigRef = useRef<DoorRig | null>(null);
  const driverEyeRef = useRef<THREE.Vector3 | null>(null);
  const onDoorsAvailableRef = useRef(onDoorsAvailable);
  const onDriverViewAvailableRef = useRef(onDriverViewAvailable);
  const onDriverViewExitRef = useRef(onDriverViewExit);
  const driverViewRef = useRef(driverView);
  /** Scene-owned overlay state read by the per-frame tick, which cannot see React props. */
  const overlayRef = useRef<{
    hotspots: Hotspot[];
    showHotspots: boolean;
    hotspotElements: Map<string, HTMLButtonElement>;
    labels: DimensionLabel[];
    labelElements: Map<string, HTMLSpanElement>;
    dimensions: THREE.Group | null;
    frame: number;
  }>({ hotspots: [], showHotspots: false, hotspotElements: new Map(), labels: [], labelElements: new Map(), dimensions: null, frame: 0 });
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [dimensionLabels, setDimensionLabels] = useState<DimensionLabel[]>([]);
  useEffect(() => {
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
    onProgressRef.current = onProgress;
    catalogRef.current = catalog;
    cameraPresetRef.current = cameraPreset;
    onTourStatusChangeRef.current = onTourStatusChange;
    onTourStepRef.current = onTourStep;
    onPartHoverRef.current = onPartHover;
    onPartSelectRef.current = onPartSelect;
    onXrSupportedRef.current = onXrSupported;
    onXrPresentingChangeRef.current = onXrPresentingChange;
    onXrErrorRef.current = onXrError;
    onQualityPreferenceLoadedRef.current = onQualityPreferenceLoaded;
    qualityPreferenceRef.current = qualityPreference;
    onQualityNeedsReloadRef.current = onQualityNeedsReload;
    lampModeRef.current = lampMode;
    onLampModesAvailableRef.current = onLampModesAvailable;
    onDoorsAvailableRef.current = onDoorsAvailable;
    onDriverViewAvailableRef.current = onDriverViewAvailable;
    onDriverViewExitRef.current = onDriverViewExit;
    driverViewRef.current = driverView;
  }, [onDoorsAvailable, onDriverViewAvailable, onDriverViewExit, driverView, lampMode, onLampModesAvailable, cameraPreset, catalog, onError, onProgress, onReady, onTourStatusChange, onTourStep, onPartHover, onPartSelect, onXrSupported, onXrPresentingChange, onXrError, onQualityPreferenceLoaded, onQualityNeedsReload, qualityPreference]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    /** Declared out here so the effect's cleanup can cancel it even if setup fails part-way. */
    let prefetcher: PrefetchScheduler | null = null;
    let cancelled = false;

    void (async () => {
      const host = hostRef.current;
      if (!host) return;

      // Fresh attempt: clear any prior empty/error notice before the next load outcome lands.
      setModelStatus(null);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#0b0f14");
      scene.fog = new THREE.Fog("#0b0f14", 16, 32);

      const renderController = await RenderController.create({
        host,
        // `cameraControllerRef`/`environmentControllerRef`, not the local `cameraController`/
        // `environmentController` consts, because both callbacks are wired before either
        // controller exists — `RenderController.create()` runs first, since camera/environment
        // construction both need the canvas it creates. By the time either callback can actually
        // fire (a real resize event, a real quality-tier change), both refs are already set.
        onResize: (width, height) => {
          cameraControllerRef.current?.setAspect(width, height);
        },
        onQualityChange: (next) => {
          environmentControllerRef.current?.applyQuality(next);
        },
        onContextLost: () => {
          onErrorRef.current("Rendering was interrupted. Attempting to recover the 3D view.");
        },
        // Prefetch (and anything else that stops while data-idle=1) must resume when the canvas
        // leaves idle — including scrolled-back-on-screen, not only visibilitychange.
        onIdleChange: (suspended) => {
          if (!suspended) prefetcher?.start();
        },
      });
      if (cancelled) {
        renderController.dispose();
        return;
      }
      renderControllerRef.current = renderController;
      // Reported only when the chrome has not already expressed a choice. Echoing the stored value
      // unconditionally would overwrite a selection the viewer made while the renderer was still
      // initialising — which the effect above has by then already persisted.
      if (qualityPreferenceRef.current === undefined) {
        onQualityPreferenceLoadedRef.current?.(readQualityPreference());
      }
      const canvasElement = renderController.canvas;

      const cameraController = new CameraController({
        domElement: canvasElement,
        initialPreset: cameraPreset,
        presets: threeDConfig.cameraPresets,
        onTourStatusChange: (status) => {
          tourActiveRef.current = status !== "idle";
          onTourStatusChangeRef.current?.(status);
        },
        onTourStep: (preset) => {
          onTourStepRef.current?.(preset);
        },
      });
      cameraControllerRef.current = cameraController;
      const camera = cameraController.camera;

      const environmentController = new EnvironmentController({
        scene,
        quality: renderController.currentQuality,
        initialTerrain: terrain,
        initialPreset: environmentPreset,
        starfieldCount: renderController.currentQuality.starfieldCount,
      });
      environmentControllerRef.current = environmentController;

      const floorReflection = new FloorReflection();
      scene.add(floorReflection.group);

      renderController.attachScene(scene, camera);
      // Only now that camera/environment exist does `onResize` (camera aspect) have something to
      // call into — matches the pre-Priority-6 ordering, where `resize()` was defined and first
      // called only after both were constructed.
      renderController.resize();

      /**
       * Keyboard cursor into `controller.findPartsByCapability("selectable")` — the "]"/"["/"Enter"
       * cases below cycle and select through it. A plain index rather than a semantic ID because
       * the list itself can change (a swapped GLB, a satisfied scene map growing); re-deriving the
       * list on every keypress and reusing the index is simpler than tracking staleness.
       */
      let keyboardPartIndex = -1;

      /**
       * Keyboard orbit, zoom, and reset.
       *
       * OrbitControls' own `listenToKeyEvents` binds the arrows to *panning*, which slides the whole
       * scene sideways and is close to useless for inspecting a vehicle — what a user wants from the
       * arrows here is to walk around it. So the orbit is computed directly, in spherical
       * coordinates about the control target, honouring the same polar and distance limits the
       * mouse path is constrained by. Without this the entire 3D stage was reachable by pointer only.
       */
      const handleKeyDown = (event: KeyboardEvent) => {
        // Never swallow a modified key: those are browser and OS shortcuts, and stealing
        // Cmd/Ctrl+arrow from a keyboard user is a worse bug than the one this fixes.
        if (event.altKey || event.ctrlKey || event.metaKey) return;

        // Keyboard orbit is the same hand-off as pointer: cancel the tour first so GSAP and the
        // camera write never fight for a frame. Unconditional (a no-op when already idle) so this
        // matches every keydown reaching this point, not only the camera-moving ones below.
        cameraController.cancelTour();

        switch (event.key) {
          case "ArrowLeft":
            cameraController.orbitBy(-KEYBOARD_ORBIT_STEP_RADIANS, 0);
            break;
          case "ArrowRight":
            cameraController.orbitBy(KEYBOARD_ORBIT_STEP_RADIANS, 0);
            break;
          case "ArrowUp":
            cameraController.orbitBy(0, -KEYBOARD_ORBIT_STEP_RADIANS);
            break;
          case "ArrowDown":
            cameraController.orbitBy(0, KEYBOARD_ORBIT_STEP_RADIANS);
            break;
          case "+":
          case "=":
            cameraController.dollyBy(-KEYBOARD_ZOOM_STEP);
            break;
          case "-":
          case "_":
            cameraController.dollyBy(KEYBOARD_ZOOM_STEP);
            break;
          case "Home":
            // Back to the active preset — a predictable escape hatch from an orbit the user has
            // lost their bearings in.
            cameraController.resetToPreset(cameraPresetRef.current);
            event.preventDefault();
            return;
          case "]":
          case "[": {
            // Keyboard equivalent of pointer hover: cycles a cursor through every selectable
            // semantic part and previews it with the same hover tint, so a part is reachable and
            // inspectable without a pointer at all.
            if (!controller) return;
            const parts = controller.findPartsByCapability("selectable");
            if (parts.length === 0) return;
            keyboardPartIndex = (keyboardPartIndex + (event.key === "]" ? 1 : -1) + parts.length) % parts.length;
            const part = parts[keyboardPartIndex]!;
            controller.hoverPart(part.id);
            canvasElement.dataset.hoveredPart = part.id;
            onPartHoverRef.current?.(part);
            event.preventDefault();
            return;
          }
          case "Enter": {
            // Selects whatever the "]"/"[" cursor is currently on. A no-op (falls through to the
            // browser default) until that cursor has been used at least once.
            if (!controller || keyboardPartIndex < 0) return;
            const part = controller.findPartsByCapability("selectable")[keyboardPartIndex];
            if (!part) return;
            controller.selectPart(part.id);
            canvasElement.dataset.selectedPart = part.id;
            onPartSelectRef.current?.(part);
            event.preventDefault();
            return;
          }
          case "f":
          case "F": {
            // Keyboard equivalent of double-click: frame the selected part (or the "]"/"[" cursor).
            if (!controller) return;
            const id = controller.selectedPartId ?? controller.hoveredPartId;
            const entry = id ? controller.getPart(id) : undefined;
            if (!entry) return;
            focusEntry(entry);
            event.preventDefault();
            return;
          }
          case "Escape": {
            if (!controller) return;
            controller.clearSelection();
            controller.hoverPart(undefined);
            canvasElement.dataset.selectedPart = "";
            canvasElement.dataset.hoveredPart = "";
            keyboardPartIndex = -1;
            onPartSelectRef.current?.(undefined);
            onPartHoverRef.current?.(undefined);
            event.preventDefault();
            return;
          }
          default:
            return;
        }

        // Only after a key was actually handled — an unrecognised key already returned above, so
        // page scrolling and browser shortcuts are left alone. Clamping and the `controls.update()`
        // write happen inside `orbitBy`/`dollyBy` themselves now.
        event.preventDefault();
      };
      host.addEventListener("keydown", handleKeyDown);

      const uninstallMetricsFlush = installMetricsFlush();

      let contactShadow: THREE.Mesh | null = null;
      let controller: VehicleSceneController | null = null;

      /**
       * Direct part interaction: pointer hover previews a part, a click/tap selects it (or clears
       * the selection when it misses everything selectable), and dragging to orbit never triggers
       * either — `three-mesh-bvh`-accelerated picking (`VehicleSceneController.pickAt`) makes the
       * raycast itself cheap; this block is what keeps it from running when nothing needs it.
       *
       * Distinguishing a click from the start of a drag is what makes this safe to layer on top of
       * `OrbitControls`, which is listening to the same `pointerdown`/`pointermove`/`pointerup`
       * sequence on this element: a `pointerup` only selects when the pointer moved less than
       * `DRAG_THRESHOLD_PX` since `pointerdown`, and hover raycasting is suppressed entirely while
       * the pointer is down and past that threshold, so an orbit drag never fights a hover pick for
       * the same frame.
       */
      const DRAG_THRESHOLD_PX = 6;
      let pointerDownAt: { x: number; y: number } | null = null;
      let isDragging = false;
      let hoverRafPending = false;
      let hoverRafId = 0;
      let lastHoverNdc: THREE.Vector2 | null = null;
      /**
       * The one pointer this block is currently tracking for a potential tap/click, by
       * `PointerEvent.pointerId`. Without this, a second finger touching down mid-gesture (the
       * start of a two-finger pinch/pan — `OrbitControls` handles that gesture itself, via its own
       * listeners on this same element) would overwrite `pointerDownAt`/`isDragging`, which were
       * mid-flight for the first finger, and could turn a pinch into a spurious selection when
       * either finger lifts. `null` means no candidate tap is in flight.
       */
      let activePointerId: number | null = null;

      const reportHover = (entry: SceneRegistryEntry | undefined) => {
        canvasElement.dataset.hoveredPart = entry?.id ?? "";
        onPartHoverRef.current?.(entry);
      };
      const reportSelection = (entry: SceneRegistryEntry | undefined) => {
        canvasElement.dataset.selectedPart = entry?.id ?? "";
        onPartSelectRef.current?.(entry);
      };

      const clearHover = () => {
        lastHoverNdc = null;
        if (!controller) return;
        controller.hoverPart(undefined);
        reportHover(undefined);
      };

      // Bounded cost: at most one raycast per animation frame no matter how many pointermove
      // events the browser delivers in between (touchpads and high-polling mice can fire well
      // past 60/s).
      const scheduleHoverPick = () => {
        if (hoverRafPending) return;
        hoverRafPending = true;
        hoverRafId = requestAnimationFrame(() => {
          hoverRafPending = false;
          if (!controller || !lastHoverNdc) return;
          const result = controller.pickAt(lastHoverNdc, camera);
          controller.hoverPart(result?.entry.id);
          reportHover(result?.entry);
        });
      };

      const isPrimaryPointer = (event: PointerEvent) => event.pointerType !== "mouse" || event.button === 0;

      /** Frames a part: around `point` when there is one (a double-click), else its bounds centre. */
      const focusEntry = (entry: SceneRegistryEntry, point?: THREE.Vector3) => {
        const box = new THREE.Box3().setFromObject(entry.object);
        if (box.isEmpty()) return;
        const center = point ?? box.getCenter(new THREE.Vector3());
        cameraController.focusOnPick([center.x, center.y, center.z], box.getSize(new THREE.Vector3()).length() / 2);
      };

      // Double-click / double-tap zooms to the spot under the pointer. The two clicks already
      // selected the part via pointerup, so this only moves the camera.
      const handleDoubleClick = (event: MouseEvent) => {
        if (!controller || event.button !== 0) return;
        const ndc = pointerToNdc(event.clientX, event.clientY, canvasElement.getBoundingClientRect());
        const result = controller.pickAt(ndc, camera);
        if (!result) return;
        cameraController.cancelTour();
        focusEntry(result.entry, result.point);
      };

      const handlePointerDown = (event: PointerEvent) => {
        if (!isPrimaryPointer(event)) return;
        if (activePointerId !== null) {
          // A second pointer went down while the first is still active — a pinch/pan gesture
          // starting, not a tap. Abandon whatever tap was in flight for the first pointer rather
          // than let this one hijack its state; its own pointerup is now a no-op (below, the
          // pointerId check on pointerup only acts for whichever pointer is still active).
          pointerDownAt = null;
          isDragging = false;
          return;
        }
        activePointerId = event.pointerId;
        pointerDownAt = { x: event.clientX, y: event.clientY };
        isDragging = false;
      };

      const handlePointerMove = (event: PointerEvent) => {
        if (event.pointerId !== activePointerId) return; // a second finger's own movement, not ours to track
        if (pointerDownAt) {
          const dx = event.clientX - pointerDownAt.x;
          const dy = event.clientY - pointerDownAt.y;
          if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) isDragging = true;
          return; // Orbiting (or about to be) — no hover raycast until the pointer is released.
        }
        lastHoverNdc = pointerToNdc(event.clientX, event.clientY, canvasElement.getBoundingClientRect());
        scheduleHoverPick();
      };

      const handlePointerUp = (event: PointerEvent) => {
        if (event.pointerId !== activePointerId) return; // a second finger lifting must not trigger a selection
        activePointerId = null;
        const downAt = pointerDownAt;
        const wasDragging = isDragging;
        pointerDownAt = null;
        isDragging = false;
        if (!downAt || wasDragging || !controller || !isPrimaryPointer(event)) return;

        const ndc = pointerToNdc(event.clientX, event.clientY, canvasElement.getBoundingClientRect());
        const result = controller.pickAt(ndc, camera);
        controller.selectPart(result?.entry.id);
        reportSelection(result?.entry);
        keyboardPartIndex = -1; // A pointer selection invalidates the keyboard cursor's meaning.
      };

      const handlePointerLeave = (event: PointerEvent) => {
        // Unlike pointermove/pointerup, this must not early-return for an untracked pointerId: a
        // plain hover (mouse moving with no pointerdown at all, so activePointerId is still null)
        // needs its own leave to clear the hover tint, which is the common case this handler
        // exists for. Drag-tracking state is only reset when the *tracked* pointer is the one
        // leaving — a second finger's own leave/cancel must not cancel the first finger's drag.
        if (event.pointerId === activePointerId) {
          activePointerId = null;
          pointerDownAt = null;
          isDragging = false;
        }
        clearHover();
      };

      canvasElement.addEventListener("pointerdown", handlePointerDown);
      canvasElement.addEventListener("pointermove", handlePointerMove);
      canvasElement.addEventListener("pointerup", handlePointerUp);
      canvasElement.addEventListener("pointerleave", handlePointerLeave);
      canvasElement.addEventListener("pointercancel", handlePointerLeave);
      canvasElement.addEventListener("dblclick", handleDoubleClick);

      /**
       * Positions the DOM overlays (hotspot buttons, dimension labels) over the canvas. Writes
       * `style.transform` directly: React state per frame would cost more than the frame.
       * Hotspot anchors need raycasts (occlusion) against the whole vehicle, so they are only
       * re-resolved when the view changes — the camera or the vehicle moved — and then one hotspot
       * per frame, round-robin. A still view costs no raycasts at all.
       */
      const hotspotAnchors = new Map<string, THREE.Vector3 | null>();
      const hotspotSamples = new Map<string, THREE.Vector3[]>();
      const lastCamera = new THREE.Matrix4();
      const lastRoot = new THREE.Matrix4();
      let lastHotspots: Hotspot[] | null = null;
      let viewDirty = true;
      let pendingAnchors: string[] = [];
      const updateOverlays = () => {
        const overlay = overlayRef.current;
        overlay.frame += 1;
        const width = canvasElement.clientWidth;
        const height = canvasElement.clientHeight;
        const place = (element: HTMLElement, point: THREE.Vector3 | null | undefined) => {
          const screen = point ? projectToScreen(point, camera, width, height) : null;
          element.hidden = !screen;
          if (screen) element.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -50%)`;
        };
        if (overlay.showHotspots && controller && !cameraController.isDriverView) {
          // Camera pose and vehicle placement (lift) together decide what is visible. Samples are
          // world-space, so only a vehicle move (or a new vehicle) invalidates them.
          if (overlay.hotspots !== lastHotspots || !controller.root.matrixWorld.equals(lastRoot)) {
            lastHotspots = overlay.hotspots;
            lastRoot.copy(controller.root.matrixWorld);
            hotspotSamples.clear();
            hotspotAnchors.clear();
            pendingAnchors = [];
            viewDirty = true;
          }
          if (!camera.matrixWorld.equals(lastCamera)) {
            lastCamera.copy(camera.matrixWorld);
            viewDirty = true;
          }
          // Finish a pass before starting the next, so a continuous orbit still reaches every hotspot.
          if (viewDirty && pendingAnchors.length === 0) {
            viewDirty = false;
            pendingAnchors = overlay.hotspots.map((hotspot) => hotspot.partId);
          }
          const partId = pendingAnchors.shift();
          if (partId) {
            const part = controller.getPart(partId);
            let samples = hotspotSamples.get(partId);
            if (part && !samples) {
              samples = surfaceSamples(part.object);
              hotspotSamples.set(partId, samples);
            }
            hotspotAnchors.set(partId, part ? resolveHotspotAnchor(part.object, controller.root, camera, samples) : null);
          }
          for (const hotspot of overlay.hotspots) {
            const element = overlay.hotspotElements.get(hotspot.partId);
            if (element) place(element, hotspotAnchors.get(hotspot.partId));
          }
        } else {
          hotspotAnchors.clear();
          lastHotspots = null;
          for (const element of overlay.hotspotElements.values()) element.hidden = true;
        }
        for (const label of overlay.labels) {
          const element = overlay.labelElements.get(label.key);
          if (element) place(element, overlay.dimensions ? label.anchor : null);
        }
      };

      // Start the render loop before the ~28 MiB GLB settles so the placeholder paints
      // immediately. Quality governance, idle suspension, WebGL context loss/restoration, rAF
      // scheduling, and frame-stat publishing are all `RenderController`'s own job now (Mission
      // Priority 6) — `tick` is the one per-frame hook it doesn't own: the camera update that has
      // to happen before each paint.
      renderController.start(() => {
        cameraController.update();
        // Read live every frame rather than pushed from effects: the tier (governor), terrain and
        // AR passthrough all change it, from three different owners. All three setters are
        // idempotent, so a steady state costs a few boolean compares.
        const reflect =
          renderController.currentQuality.floorReflection &&
          environmentController.currentTerrain === "Studio" &&
          !environmentController.isPassthrough;
        floorReflection.setEnabled(reflect);
        environmentController.setFloorReflective(reflect);
        // Only hazards animate; checked first so a steady lamp mode costs no media query per frame.
        const lights = sceneControllerRef.current?.lights;
        if (lights?.currentMode === "hazard") lights.update(performance.now(), prefersReducedMotion());
        floorReflection.sync();
        // The seat can be left by a camera preset or Home without the chrome asking; tell it.
        if (driverViewRef.current && !cameraController.isDriverView) {
          driverViewRef.current = false;
          onDriverViewExitRef.current?.();
        }
        updateOverlays();
      });

      // Assign cleanup before any await so an unmount mid-load still tears the renderer down.
      cleanup = () => {
        // A pending hover raycast (`scheduleHoverPick`) is scheduled independently of
        // `RenderController`'s own rAF chain, so it needs its own cancellation — otherwise a
        // hover pick queued just before unmount could still fire afterward.
        if (hoverRafPending) {
          cancelAnimationFrame(hoverRafId);
          hoverRafPending = false;
        }
        uninstallMetricsFlush();
        cameraControllerRef.current?.dispose();
        cameraControllerRef.current = null;
        tourActiveRef.current = false;
        host.removeEventListener("keydown", handleKeyDown);
        canvasElement.removeEventListener("pointerdown", handlePointerDown);
        canvasElement.removeEventListener("pointermove", handlePointerMove);
        canvasElement.removeEventListener("pointerup", handlePointerUp);
        canvasElement.removeEventListener("pointerleave", handlePointerLeave);
        canvasElement.removeEventListener("pointercancel", handlePointerLeave);
        canvasElement.removeEventListener("dblclick", handleDoubleClick);
        sceneControllerRef.current = null;
        doorRigRef.current = null;
        driverEyeRef.current = null;
        if (overlayRef.current.dimensions) {
          disposeDimensionsOverlay(overlayRef.current.dimensions);
          overlayRef.current.dimensions = null;
        }
        steerRef.current = null;
        floorReflection.dispose();
        environmentControllerRef.current?.dispose();
        environmentControllerRef.current = null;
        renderControllerRef.current?.dispose();
        renderControllerRef.current = null;
        if (controller) {
          controller.dispose();
          // Defense in depth alongside the rAF cancellation above: any other callback still
          // holding this closure (there should be none once every listener above is removed and
          // the hover rAF is cancelled) sees a disposed scene as "no controller" rather than a
          // live-looking reference into torn-down state.
          controller = null;
        } else if (rootRef.current) {
          // Placeholder (or unsettled root) is not owned by the controller yet.
          scene.remove(rootRef.current);
          disposeSubtree(rootRef.current);
        }
        if (contactShadow) disposeContactShadow(contactShadow);
        rootRef.current = null;
      };

      if (import.meta.env.DEV) {
        (window as unknown as Record<string, unknown>).__vehicleFrameStats = () => renderController.getFrameStats();
      }

      let progressive = initialProgressiveState();

      const publishReady = (root: THREE.Object3D) => {
        if (import.meta.env.DEV) {
          (window as unknown as Record<string, unknown>).__dumpVehicleHierarchy = () => logHierarchy(root);
        }
        const report = verifyNodeContract(root, catalogRef.current);
        for (const entry of report.unsatisfied) {
          console.warn(
            `[customization] option "${entry.option.id}" is unavailable for this asset.`,
            { missingNodes: entry.missingNodes, missingMaterials: entry.missingMaterials },
          );
        }
        controller = new VehicleSceneController(root, report.satisfied, getSceneMapForVehicle(slug));
        sceneControllerRef.current = controller;
        if (lampModeRef.current) controller.lights.setMode(lampModeRef.current);
        onLampModesAvailableRef.current?.(controller.lights.availableModes());
        for (const unsatisfied of controller.sceneMapReport.unsatisfied) {
          // Distinct wording from the customization-option warning just above on purpose: a
          // forward-declared scene-map entry with no matching geometry yet (tests/e2e/model-
          // integrity.spec.ts asserts zero of *those*) is an expected, documented state for a part
          // this GLB doesn't model separately — not the same failure as a catalog option whose
          // node the asset pipeline accidentally dropped.
          console.warn(`[scene] part "${unsatisfied.entry.id}" has no matching geometry in this asset: ${unsatisfied.reason}`);
        }
        keyboardPartIndex = -1;
        onReadyRef.current(controller, report.satisfied);
      };

      /** Everything that changes which shader programs `root` needs — texture stripping, shadow
       * flags, the procedural kit's materials — so `precompile` compiles the variants that will
       * actually be drawn. Nothing here touches the live scene. */
      const prepareSettledRoot = (root: THREE.Object3D) => {
        prepareVehicleRoot(root, threeDConfig);
        root.updateWorldMatrix(true, true);
        buildProceduralAccessories(root);
        buildRuntimeModificationKit(root, slug);
        // Measured off this vehicle's own running gear, so it must run after the root is prepared
        // and before `verifyNodeContract` — the wheel-package options name these nodes. It runs
        // after the runtime mod kit so its own `RUNTIME_MOD_*` meshes are already excluded from
        // anything either builder measures.
        installProceduralWheelPackages(root, slug);
      };

      const attachSettledRoot = (root: THREE.Object3D) => {
        const footprint = new THREE.Box3().setFromObject(root);
        if (contactShadow) {
          scene.remove(contactShadow);
          disposeContactShadow(contactShadow);
        }
        contactShadow = createContactShadow(footprint);
        scene.add(contactShadow);
        scene.add(root);
        floorReflection.setSource(root);
        // Captured at rest, after grounding; the preset effect below animates it from here.
        const steer = threeDConfig.heroSteer && root.userData.__progressivePlaceholder !== true
          ? new FrontWheelSteer(root, threeDConfig.heroSteer.nodeNames)
          : null;
        if (steer) steer.setAngle(steerAngleForPreset(cameraPresetRef.current.id, threeDConfig.heroSteer?.degrees));
        steerRef.current = steer;

        const isPlaceholder = root.userData.__progressivePlaceholder === true;
        // Doors: only assets that model them separately, and never the procedural stand-in.
        const doors = !isPlaceholder && threeDConfig.doors?.length ? new DoorRig(root, threeDConfig.doors) : null;
        doorRigRef.current = doors && doors.available.length > 0 ? doors : null;
        onDoorsAvailableRef.current?.(doorRigRef.current !== null);
        // Driver's seat: only with interior geometry to sit in.
        driverEyeRef.current = isPlaceholder ? null : driverEyeFor(root, threeDConfig.driverView?.steeringWheelNodeNames);
        onDriverViewAvailableRef.current?.(driverEyeRef.current !== null);
        rootRef.current = root;
        groundedYRef.current = root.position.y;
        setSceneRevision((revision) => revision + 1);
        publishReady(root);
      };

      const wantsDetailedModel = Boolean(threeDConfig.hasModel && threeDConfig.modelUrl);

      if (!wantsDetailedModel) {
        progressive = reduceProgressiveLoad(progressive, { type: "no-model" });
        // Informational empty state — not a failure; chrome stays fully usable.
        setModelStatus("empty");
        const root = createProceduralVehicle();
        if (cancelled) {
          disposeSubtree(root);
          return;
        }
        prepareSettledRoot(root);
        attachSettledRoot(root);
      } else {
        // Progressive path: paint a procedural stand-in first, then swap when the GLB settles.
        progressive = reduceProgressiveLoad(progressive, { type: "start-placeholder" });
        const placeholder = createProceduralVehicle();
        placeholder.name = "PROGRESSIVE_PLACEHOLDER";
        placeholder.userData.__progressivePlaceholder = true;
        // Rough showroom placement so the stand-in is grounded before prepareVehicleRoot runs on
        // the detailed mesh (placeholder is never handed to the catalog / controller).
        placeholder.position.y = 0;
        placeholder.rotation.y = Math.PI;
        scene.add(placeholder);
        floorReflection.setSource(placeholder);
        rootRef.current = placeholder;
        groundedYRef.current = placeholder.position.y;
        setSceneRevision((revision) => revision + 1);

        progressive = reduceProgressiveLoad(progressive, { type: "start-loading" });
        canvasElement.dataset.loadPhase = progressive.phase;

        let detailed: THREE.Object3D | null = null;
        try {
          const modelStartedAt = performance.now();
          detailed = await loadVehicleRoot(
            threeDConfig,
            renderController.currentQuality.modelDetail,
            (fraction) => onProgressRef.current?.(fraction),
          );
          // Download *and* Draco decode together, which is the number that matters: after
          // scripts/optimize-models.mjs took the payload to ~1.2 MiB, decode is expected to
          // dominate, and that is exactly the assumption worth checking against real devices.
          recordMetric({
            name: "model_loaded",
            value: Math.round(performance.now() - modelStartedAt),
            labels: { detail: renderController.currentQuality.modelDetail },
          });
          progressive = reduceProgressiveLoad(progressive, { type: "glb-decoded" });
        } catch (error) {
          console.error("High-detail glTF failed to load; using procedural fallback.", error);
          // Labeled on-canvas error + Retry (#75). Procedural fallback still mounts so chrome
          // (options, pricing, share) keeps working — this is not CanvasErrorBoundary territory.
          setModelStatus("error");
          onErrorRef.current("The detailed model could not be loaded. Showing a simplified vehicle.");
          progressive = reduceProgressiveLoad(progressive, { type: "load-failed" });
        }

        if (cancelled) {
          if (detailed) disposeSubtree(detailed);
          scene.remove(placeholder);
          disposeSubtree(placeholder);
          rootRef.current = null;
          return;
        }

        canvasElement.dataset.loadPhase = progressive.phase;

        if (detailed && progressive.hasDetailedModel) {
          if (renderController.currentQuality.loadAuthoredRunningGear) {
            try {
              await installWheelAndTireAssets(detailed, threeDConfig);
            } catch (error) {
              console.warn("[customization] supplied wheel and tyre glTFs could not be loaded.", error);
            }
          }
          prepareSettledRoot(detailed);
          // Compiled while the placeholder is still the thing on screen, so the swap below lands on
          // a frame that only has to draw, not compile.
          await renderController.precompile(detailed, scene);
          if (cancelled) {
            disposeSubtree(detailed);
            scene.remove(placeholder);
            disposeSubtree(placeholder);
            rootRef.current = null;
            return;
          }
          floorReflection.setSource(null);
          scene.remove(placeholder);
          disposeSubtree(placeholder);
          setModelStatus(null);
          attachSettledRoot(detailed);
          progressive = reduceProgressiveLoad(progressive, { type: "settled" });
        } else {
          // Promote the placeholder to the permanent fallback root.
          scene.remove(placeholder);
          prepareSettledRoot(placeholder);
          attachSettledRoot(placeholder);
        }
      }

      canvasElement.dataset.loadPhase = progressive.phase;

      // Only now — the vehicle is on screen and settled — is speculative work allowed to start.
      // Prefetching HDRIs before this point would compete for bandwidth with the vehicle itself.
      // The paint studio's `hdri-sunset` preset carries a real `.hdr` that is otherwise fetched,
      // parsed and PMREM-filtered while the viewer waits on a preset they have already been shown.
      prefetcher = createPrefetchScheduler({
        load: prefetchHdriPreset,
        ids: HDRI_PRESETS.filter((preset) => preset.hdrUrl).map((preset) => preset.id),
        // Read live, not snapshotted: the governor can downgrade after this scheduler is built, and
        // a frozen tier would keep fetching on exactly the device that just told us it is struggling.
        tier: () => renderController.currentQuality.tier,
        saveData: (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true,
        isSuspended: () => canvasElement.dataset.idle === "1",
        // Medium reduces (one warm); low is already hard-disabled via tier().
        maxItems: () => prefetchBudgetForTier(renderController.currentQuality.tier),
      });
      prefetcher.start();

      // `start()` is also the resume path — the scheduler stops rather than spinning while suspended.
      // Resume is wired through `RenderController`'s `onIdleChange` (above), which covers both
      // visibilitychange and IntersectionObserver — listening only to visibility left scrolled-away
      // canvases unable to restart prefetch when they came back on screen.

      // XR last: it needs the renderer, and there is nothing worth showing in AR until the vehicle
      // has actually settled into the scene.
      const xrController = new XrSessionController({
        renderer: renderController.renderer as unknown as ConstructorParameters<typeof XrSessionController>[0]["renderer"],
        onPresentingChange: (presenting) => {
          if (presenting) {
            // Stop everything that writes the camera before handing the pose to the device.
            //
            // `setControlsEnabled(false)` alone only refuses new *input*; it does not stop a GSAP
            // cinematic tour still tweening position and target, auto-rotate advancing on every
            // `update()`, or residual damping. Any of those moves the virtual origin while the
            // headset is supplying the real pose — the scene drifts under the viewer's head, which
            // is motion sickness rather than a camera bug. The tour also has to be cancelled rather
            // than paused, or exiting XR would resume it mid-shot and re-enable controls it thinks
            // it owns.
            cameraController.cancelTour();
            cameraController.setAutoRotate(false);
            cameraController.setControlsEnabled(false);
            // A renderer with `alpha: true` is necessary but not sufficient: the opaque background,
            // fog and floor would still occlude the camera feed.
            environmentControllerRef.current?.setPassthrough(true);
          }

          renderController.setXrPresenting(presenting);

          if (!presenting) {
            environmentControllerRef.current?.setPassthrough(false);
            cameraController.setControlsEnabled(true);
          }

          onXrPresentingChangeRef.current?.(presenting);
        },
        onError: (message) => {
          // Prefer the XR-specific channel so a declined permission is not painted as a GLB failure.
          if (onXrErrorRef.current) onXrErrorRef.current(message);
          else onErrorRef.current(message);
        },
      });
      xrControllerRef.current = xrController;
      void xrController.isSupported().then((supported) => {
        if (!cancelled) onXrSupportedRef.current?.(supported);
      });

      if (import.meta.env.DEV) {
        (window as unknown as Record<string, unknown>).__vehicleProgressiveLoad = progressive;
        (window as unknown as Record<string, unknown>).__vehicleQuality = renderController.currentQuality;
        (window as unknown as Record<string, unknown>).__vehiclePrefetch = () => prefetcher?.completed() ?? [];
      }

      // cleanup already assigned above (before GLB await).
    })().catch((error) => {
      console.error("Vehicle scene initialization failed:", error);
      onErrorRef.current(error instanceof Error ? error.message : String(error));
    });

    return () => {
      cancelled = true;
      // Before `cleanup`: an in-flight prefetch holds no scene references, but there is no reason to
      // let speculative fetches outlive the canvas that wanted them.
      prefetcher?.dispose();
      prefetcher = null;
      // Before the renderer goes: ending the session releases the device camera, and a session
      // outliving its canvas leaves that running behind a page the viewer has left.
      xrControllerRef.current?.dispose();
      xrControllerRef.current = null;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setup once per model/retry; see latest-value refs above.
  }, [threeDConfig, loadAttempt]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Lift is an offset from the grounded baseline, not an absolute position: writing `lift * 0.045`
    // straight into `position.y` would discard the grounding offset computed at load and drop the
    // vehicle through the floor.
    gsap.to(root.position, {
      y: groundedYRef.current + lift * 0.045,
      duration: motionDuration(0.35),
      ease: "power2.out",
    });
  }, [lift, sceneRevision]);

  useEffect(() => {
    const cameraController = cameraControllerRef.current;
    if (!cameraController) return;
    // Tour owns the same vectors via its timeline; a toolbar highlight update from onTourStep must
    // not start a parallel tween that fights it. The longest movement on the stage, and the one
    // most likely to provoke motion sickness (the camera swings bodily across the scene), is
    // handled inside `transitionToPreset` itself — reduced motion cuts it, preserving the
    // destination without the journey.
    if (tourActiveRef.current) return;
    cameraController.transitionToPreset(cameraPreset);
  }, [cameraPreset]);

  useEffect(() => {
    // Hero shot: wheels turned to show their face; every other preset: straight ahead. Tweened with
    // the camera move (reduced motion lands it instantly, like the camera itself).
    const steer = steerRef.current;
    if (!steer) return;
    const target = steerAngleForPreset(cameraPreset.id, threeDConfig.heroSteer?.degrees);
    const proxy = { angle: steer.currentAngle };
    const tween = gsap.to(proxy, {
      angle: target,
      duration: motionDuration(0.6),
      ease: "power2.inOut",
      onUpdate: () => steer.setAngle(proxy.angle),
    });
    return () => {
      tween.kill();
    };
  }, [cameraPreset.id, sceneRevision, threeDConfig.heroSteer?.degrees]);

  useEffect(() => {
    const doors = doorRigRef.current;
    if (!doors) return;
    const proxy = { amount: doors.openAmount };
    const tween = gsap.to(proxy, {
      amount: doorsOpen ? 1 : 0,
      duration: motionDuration(0.9),
      ease: "power2.inOut",
      onUpdate: () => doors.setOpenAmount(proxy.amount),
    });
    return () => {
      tween.kill();
    };
  }, [doorsOpen, sceneRevision]);

  useEffect(() => {
    const camera = cameraControllerRef.current;
    const eye = driverEyeRef.current;
    if (!camera) return;
    if (driverView && eye && !camera.isDriverView) camera.enterDriverView(eye);
    else if (!driverView && camera.isDriverView) camera.exitDriverView();
  }, [driverView, sceneRevision]);

  useEffect(() => {
    // Hotspots are chosen once per settled vehicle from its registered parts and the categories the
    // chrome says it serves.
    const controller = sceneControllerRef.current;
    const next = controller && hotspotCategories?.length
      ? selectHotspots(controller.listParts(), new Set(hotspotCategories))
      : [];
    overlayRef.current.hotspots = next;
    setHotspots(next);
  }, [hotspotCategories, sceneRevision]);

  useEffect(() => {
    overlayRef.current.showHotspots = showHotspots;
  }, [showHotspots]);

  useEffect(() => {
    // Rebuilt on lift changes too: the lines are measured off the model where it currently sits.
    const overlay = overlayRef.current;
    if (overlay.dimensions) {
      disposeDimensionsOverlay(overlay.dimensions);
      overlay.dimensions = null;
    }
    const root = rootRef.current;
    const scene = root?.parent;
    if (!showDimensions || !root || !scene || root.userData.__progressivePlaceholder === true) {
      overlay.labels = [];
      setDimensionLabels([]);
      return;
    }
    let cancelled = false;
    // After the lift tween lands (~0.35 s), so the lines are drawn where the vehicle ends up.
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const { group, labels } = buildDimensionsOverlay(visibleBounds(root), dimensionSpecs ?? []);
      scene.add(group);
      overlay.dimensions = group;
      overlay.labels = labels;
      setDimensionLabels(labels);
    }, motionDuration(0.4) * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [showDimensions, dimensionSpecs, lift, sceneRevision]);

  useEffect(() => {
    if (!lampMode) return;
    sceneControllerRef.current?.lights.setMode(lampMode);
  }, [lampMode]);

  useEffect(() => {
    // `undefined` is the initial render, not a request — resetting on mount would fight the
    // preset transition that has just been started for the initial pose.
    if (resetViewSignal === undefined) return;
    const cameraController = cameraControllerRef.current;
    if (!cameraController) return;
    // Snaps rather than tweens, matching the Home key: a reset is a recovery action, and someone
    // who has lost the vehicle off-frame wants it back now, not in 0.85s.
    cameraController.resetToPreset(cameraPresetRef.current);
  }, [resetViewSignal]);

  useEffect(() => {
    // `undefined` means the chrome is not driving this; leave whatever the renderer read from
    // storage in place rather than forcing it back to a default the viewer did not choose.
    if (qualityPreference === undefined) return;
    const controller = renderControllerRef.current;
    if (controller) {
      controller.setQualityPreference(qualityPreference);
      onQualityNeedsReloadRef.current?.(controller.qualityPreferenceNeedsReload(qualityPreference));
      return;
    }
    // The renderer may not exist yet: `VehicleCanvas` is `lazy()`-imported and `RenderController
    // .create` awaits `renderer.init()`, so the selector is interactive for a while before there is
    // anything to apply to. Persisting here means the choice is not silently dropped — the
    // controller reads the stored preference during construction, so it picks this up on arrival
    // (including `antialias`, which only construction can set).
    writeQualityPreference(qualityPreference);
  }, [qualityPreference]);

  useEffect(() => {
    if (enterXrSignal === undefined) return;
    void xrControllerRef.current?.enter();
  }, [enterXrSignal]);

  useEffect(() => {
    if (exitXrSignal === undefined) return;
    void xrControllerRef.current?.exit();
  }, [exitXrSignal]);

  // Builder chrome play/pause/cancel — seq bumps so repeated identical actions still fire.
  useEffect(() => {
    if (!tourAction) return;
    const cameraController = cameraControllerRef.current;
    if (!cameraController) return;
    if (tourAction.type === "play") cameraController.playTour();
    else if (tourAction.type === "pause") cameraController.pauseTour();
    else cameraController.cancelTour();
  }, [tourAction]);

  useEffect(() => {
    // Keep the tour path in sync if the vehicle's catalog presets change (vehicle switch remounts
    // the canvas via threeDConfig, but setPresets is cheap insurance for hot catalog edits).
    cameraControllerRef.current?.setPresets(threeDConfig.cameraPresets);
  }, [threeDConfig.cameraPresets]);

  useEffect(() => {
    environmentControllerRef.current?.setTerrainAndPreset(terrain, environmentPreset);
  }, [terrain, environmentPreset]);

  useEffect(() => {
    const environmentController = environmentControllerRef.current;
    const renderController = renderControllerRef.current;
    if (!environmentController || !renderController) return;
    // A configuration saved before paint-studio existed carries no preset; it still gets the default
    // lighting and its environment map rather than none at all.
    const presetId = hdriPresetId ?? DEFAULT_HDRI_PRESET_ID;
    // Supersession (a slower, superseded request's late-arriving result being discarded) is
    // EnvironmentController's own job now — see `applyHdri`'s doc comment — so this effect no
    // longer needs its own `cancelled` flag/cleanup for that race.
    void environmentController.applyHdri(renderController.renderer, presetId).then(() => {
      // Which preset's lighting is actually live — the 3D visual snapshots wait on this, since the
      // HDR fetch + PMREM lands asynchronously after the model settles.
      renderController.canvas.dataset.environment = presetId;
    });
  }, [hdriPresetId, terrain, environmentPreset, sceneRevision]);

  return (
    <>
      <div
        ref={hostRef}
        className="vehicle-canvas"
        // `tabIndex` is what puts the 3D stage in the tab order at all; before this the entire
        // viewport was pointer-only. `group` rather than `application`: the element is a composite
        // widget the user steps into, and `application` would suppress the screen reader's own
        // navigation keys everywhere inside it in exchange for nothing this needs.
        tabIndex={0}
        role="group"
        aria-label={
          "Vehicle viewer. Use arrow keys to orbit the vehicle, plus and minus to zoom, " +
          "and Home to return to the selected camera angle. Use the right and left bracket keys " +
          "to cycle through selectable vehicle parts, Enter to select the highlighted part, and " +
          "Escape to clear the selection, and F to zoom to the selected part. Click or tap a part " +
          "directly to select it; double-click to zoom to it."
        }
      />
      <div className="scene-overlay" aria-hidden={hotspots.length === 0 && dimensionLabels.length === 0 ? true : undefined}>
        {showHotspots
          ? hotspots.map((hotspot) => (
              <button
                key={hotspot.partId}
                type="button"
                className="scene-hotspot"
                hidden
                ref={(element) => {
                  const map = overlayRef.current.hotspotElements;
                  if (element) map.set(hotspot.partId, element);
                  else map.delete(hotspot.partId);
                }}
                aria-label={`${hotspot.label}: customize`}
                title={`${hotspot.label} — customize`}
                onClick={() => onHotspotActivate?.(hotspot.category)}
              >
                <span aria-hidden="true" />
              </button>
            ))
          : null}
        {dimensionLabels.map((label) => (
          <span
            key={label.key}
            className="scene-dimension"
            hidden
            ref={(element) => {
              const map = overlayRef.current.labelElements;
              if (element) map.set(label.key, element);
              else map.delete(label.key);
            }}
          >
            {label.text}
          </span>
        ))}
      </div>
      {modelStatus ? (
        <CanvasModelStatus
          kind={modelStatus}
          onRetry={
            modelStatus === "error"
              ? () => {
                  setModelStatus(null);
                  setLoadAttempt((attempt) => attempt + 1);
                }
              : undefined
          }
        />
      ) : null}
    </>
  );
}

/** A soft radial-gradient disc rather than a real-time shadow: it reads as a grounding cue under
 * every lighting preset and camera angle, including ones where the directional shadow map is thin
 * or absent (e.g. a shallow key-light angle), instead of the vehicle relying on the dynamic shadow
 * alone to look like it's resting on the floor. */
function createContactShadow(footprint: THREE.Box3): THREE.Mesh {
  const size = footprint.getSize(new THREE.Vector3());
  const width = Math.max(size.x, 0.5) * 1.6;
  const depth = Math.max(size.z, 0.5) * 1.3;

  const texture = createRadialGradientTexture();
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
  mesh.name = "CONTACT_SHADOW";
  mesh.rotation.x = -Math.PI / 2;
  // A hair above the floor (y = 0) and below the grid (y = 0.002) so it never z-fights with either.
  mesh.position.y = 0.0012;
  return mesh;
}

function disposeContactShadow(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const material = mesh.material as THREE.MeshBasicMaterial;
  material.map?.dispose();
  material.dispose();
}

function createRadialGradientTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(0,0,0,0.6)");
  gradient.addColorStop(0.55, "rgba(0,0,0,0.32)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

async function loadVehicleRoot(
  threeDConfig: Vehicle3DConfig,
  detail: QualitySettings["modelDetail"],
  onProgress?: (fraction: number) => void,
): Promise<THREE.Object3D> {
  const modelUrl = modelUrlForDetail(threeDConfig, detail);
  if (!threeDConfig.hasModel || !modelUrl) return createProceduralVehicle();
  const gltf = await getGltfLoader().loadAsync(resolveAssetUrl(modelUrl), (event) => {
    // `lengthComputable` is false whenever the response has no usable `Content-Length` — common for
    // a gzipped GLB. Reporting `loaded / 0` would emit Infinity, and guessing a denominator would
    // show a progress bar that lies; skipping the callback lets the UI fall back to the
    // placeholder's own indeterminate affordance.
    if (!event.lengthComputable || event.total <= 0) return;
    onProgress?.(Math.min(event.loaded / event.total, 1));
  });
  return gltf.scene;
}

/**
 * Mounts the supplied standalone running-gear assets at the authored wheel mounts. The original
 * meshes are removed (not merely hidden) so the catalog's exact node-name contract resolves to
 * the replacements and the scene never renders duplicate wheels or tyres.
 */
async function installWheelAndTireAssets(root: THREE.Object3D, threeDConfig: Vehicle3DConfig): Promise<void> {
  const config = threeDConfig.wheelAndTireAssets;
  if (!config) return;

  const mounts = threeDConfig.wheelMountNames.map((name) => findNodeByName(root, name));
  if (mounts.some((mount) => !mount)) {
    console.warn("[customization] supplied wheel and tyre glTFs were not mounted: wheel mounts are missing.");
    return;
  }

  const [wheelSource, tireSource] = await Promise.all([loadAsset(config.wheelUrl), loadAsset(config.tireUrl)]);

  for (let index = 0; index < mounts.length; index += 1) {
    const wheelNodeName = config.wheelNodeNames[index]!;
    const tireNodeName = config.tireNodeNames[index]!;

    // Remove the model's baked-in pair before naming replacements, avoiding duplicate matches in
    // `getObjectByName` as well as duplicate visible geometry.
    removeNode(findNodeByName(root, wheelNodeName));
    removeNode(findNodeByName(root, tireNodeName));

    const assembly = new THREE.Group();
    assembly.name = `AUTHORED_RUNNING_GEAR_${index}`;

    const tire = instantiateAsset(tireSource);
    tire.name = tireNodeName;
    const wheel = instantiateAsset(wheelSource);
    wheel.name = wheelNodeName;
    renameMaterials(wheel, index < 2 ? "wheel.metal" : "wheel.metal.001");

    assembly.add(tire, wheel);
    // This authored wheel+tire pair is baseline vehicle geometry, not an option attachment.
    // Keeping it unmarked means a wheel-only replacement can hide the stock rim without
    // detaching the sibling tire, then restore the rim when the replacement is cleared.
    mounts[index]!.add(assembly);
    assembly.scale.setScalar(config.scale ?? 1);
  }
}

function removeNode(node: THREE.Object3D | undefined): void {
  node?.parent?.remove(node);
}

/**
 * Renames the `wheel.metal` slot on `root`'s meshes to `name`, cloning the material first.
 *
 * `instantiateAsset` reuses geometry and materials by reference (`SkeletonUtils.clone`, see
 * `assets.ts`), so all four wheel assemblies mounted from the same source share one `wheel.metal`
 * `Material` instance. Renaming it in place — the previous behaviour — mutated that shared object:
 * relabelling the rear pair to `wheel.metal.001` silently relabelled the front pair too, since both
 * pairs pointed at the same object, leaving no mesh named `wheel.metal` at all. Every wheel-colour
 * catalog option targets both slots by name (`WHEEL_MATERIALS = ["wheel.metal", "wheel.metal.001"]`
 * in `lib/data/options/*.ts`), so that collapsed contract silently dropped every one of them from
 * the served catalog (`verifyNodeContract` reports the missing slot and removes the option, exactly
 * as it's designed to for a genuinely absent material — there was no way for it to tell renamed and
 * missing apart). Cloning here gives this wheel assembly its own material instance to rename,
 * leaving the shared cached original — and every other assembly still using it — untouched.
 */
function renameMaterials(root: THREE.Object3D, name: string): void {
  if (name === "wheel.metal") return;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const renamed = materials.map((material) => {
      if (material.name !== "wheel.metal") return material;
      const clone = material.clone();
      clone.name = name;
      return clone;
    });
    object.material = Array.isArray(object.material) ? renamed : renamed[0]!;
  });
}

/**
 * Hides retained donor geometry, then centres and grounds the vehicle using only the nodes the
 * catalog nominates. Exported for the grounding test.
 */
export function prepareVehicleRoot(root: THREE.Object3D, threeDConfig: Vehicle3DConfig): void {
  root.name = "VEHICLE_ROOT";
  if (threeDConfig.scale) root.scale.set(...threeDConfig.scale);
  root.rotation.set(
    threeDConfig.rotation?.[0] ?? 0,
    Math.PI + (threeDConfig.rotation?.[1] ?? 0),
    threeDConfig.rotation?.[2] ?? 0,
  );

  for (const name of threeDConfig.hiddenNodeNames ?? []) {
    const node = findNodeByName(root, name);
    if (node) node.visible = false;
    else console.warn(`[customization] hiddenNodeNames references a missing node: "${name}"`);
  }

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });

  const box = boundsOf(root, threeDConfig.groundingNodeNames);
  if (box) {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    root.position.sub(center);
    root.position.y += size.y / 2;
  }
  if (threeDConfig.texturePolicy === "factors-only") stripMaterialTextures(root);
}

/**
 * Some authored GLBs contain texture/sampler combinations that produce invalid WebGL draw calls
 * on fallback backends. Keep the authored materials, names, and PBR scalar factors, but remove
 * only optional texture bindings when the catalog explicitly opts into the compatibility policy.
 */
function stripMaterialTextures(root: THREE.Object3D): void {
  const textureSlots = [
    "map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap",
    "bumpMap", "displacementMap", "clearcoatMap", "clearcoatNormalMap", "clearcoatRoughnessMap",
    "sheenColorMap", "sheenRoughnessMap", "specularIntensityMap", "specularColorMap",
  ];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const slots = material as unknown as Record<string, unknown>;
      for (const slot of textureSlots) {
        if (slot in slots) slots[slot] = null;
      }
      material.needsUpdate = true;
    }
  });
}

function boundsOf(root: THREE.Object3D, nodeNames?: string[]): THREE.Box3 | null {
  root.updateWorldMatrix(true, true);

  if (!nodeNames?.length) return new THREE.Box3().setFromObject(root);

  const box = new THREE.Box3();
  let any = false;
  for (const name of nodeNames) {
    const node = findNodeByName(root, name);
    if (!node) continue;
    box.expandByObject(node);
    any = true;
  }
  return any ? box : new THREE.Box3().setFromObject(root);
}

/** The driver's eye, placed from the configured steering-wheel nodes; `null` (no Driver view) when
 * none is configured or none resolves in this asset. */
function driverEyeFor(root: THREE.Object3D, nodeNames: readonly string[] | undefined): THREE.Vector3 | null {
  const wheel = (nodeNames ?? []).map((name) => findNodeByName(root, name)).filter((node): node is THREE.Object3D => Boolean(node));
  if (wheel.length === 0) return null;
  root.updateWorldMatrix(true, true);
  const bounds = worldBoundsOf(wheel);
  return bounds.isEmpty() ? null : driverEyeFromSteeringWheel(bounds);
}

/** Bounds of the visible geometry only. `Box3.setFromObject` counts hidden nodes too — the hidden
 * procedural accessories and runtime kit would otherwise stretch a measurement. */
function visibleBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  const visit = (object: THREE.Object3D) => {
    if (!object.visible) return;
    if (object instanceof THREE.Mesh) box.expandByObject(object, false);
    for (const child of object.children) visit(child);
  };
  visit(root);
  return box.isEmpty() ? new THREE.Box3().setFromObject(root) : box;
}
