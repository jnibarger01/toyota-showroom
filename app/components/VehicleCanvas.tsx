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
import gsap from "gsap";
import * as THREE from "three";
import type { Vehicle3DConfig } from "../../lib/types/vehicle";
import type { CustomizationOption } from "../../lib/types/customization";
import { VehicleSceneController } from "../../lib/three/sceneController";
import { attachToMount, getGltfLoader, instantiateAsset, loadAsset, disposeSubtree } from "../../lib/three/assets";
import { logHierarchy, verifyNodeContract } from "../../lib/three/nodes";
import { getSceneMapForVehicle } from "../../lib/data/sceneMap";
import { pointerToNdc } from "../../lib/three/picking";
import type { SceneRegistryEntry } from "../../lib/three/sceneRegistry";
import { buildProceduralAccessories, createProceduralVehicle } from "../../lib/three/proceduralParts";
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
import { createPrefetchScheduler, type PrefetchScheduler } from "../../lib/three/prefetch";
import { XrSessionController } from "../../lib/three/xrSession";
import { readQualityPreference, type QualityPreference } from "../../lib/three/qualityPreference";
import { prefetchHdriPreset } from "../../lib/three/hdriEnvironment";
import { HDRI_PRESETS } from "../../lib/data/paintStudio";
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
   * Viewer's quality choice. `"auto"` hands the tier back to `QualityGovernor`; anything else pins
   * it, suspending automatic adaptation — see `lib/three/qualityPreference.ts` for why a pinned
   * tier turns the governor off rather than merely seeding it.
   */
  qualityPreference?: QualityPreference;
  /** Reports the stored preference once the renderer exists, so the chrome can show the real value
   * rather than assuming a default the viewer may have changed on a previous visit. */
  onQualityPreferenceLoaded?: (preference: QualityPreference) => void;
  /** Reports whether this device can offer AR at all, so the chrome can omit the control entirely
   * rather than show one that fails on tap. */
  onXrSupported?: (supported: boolean) => void;
  /** Reports session start/end so the chrome can swap the control and hide overlapping UI. */
  onXrPresentingChange?: (presenting: boolean) => void;
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
};

export function VehicleCanvas({ threeDConfig, slug, catalog, cameraPreset, lift, terrain, environmentPreset, hdriPresetId, onReady, onError, onProgress, tourAction, resetViewSignal, enterXrSignal, onXrSupported, onXrPresentingChange, qualityPreference, onQualityPreferenceLoaded, onTourStatusChange, onTourStep, onPartHover, onPartSelect }: Props) {
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
  const onQualityPreferenceLoadedRef = useRef(onQualityPreferenceLoaded);
  const xrControllerRef = useRef<XrSessionController | null>(null);
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
    onQualityPreferenceLoadedRef.current = onQualityPreferenceLoaded;
  }, [cameraPreset, catalog, onError, onProgress, onReady, onTourStatusChange, onTourStep, onPartHover, onPartSelect, onXrSupported, onXrPresentingChange, onQualityPreferenceLoaded]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    /** Declared out here so the effect's cleanup can cancel it even if setup fails part-way. */
    let prefetcher: PrefetchScheduler | null = null;
    let cancelled = false;

    void (async () => {
      const host = hostRef.current;
      if (!host) return;

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
      });
      if (cancelled) {
        renderController.dispose();
        return;
      }
      renderControllerRef.current = renderController;
      onQualityPreferenceLoadedRef.current?.(readQualityPreference());
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

      // Start the render loop before the ~28 MiB GLB settles so the placeholder paints
      // immediately. Quality governance, idle suspension, WebGL context loss/restoration, rAF
      // scheduling, and frame-stat publishing are all `RenderController`'s own job now (Mission
      // Priority 6) — `tick` is the one per-frame hook it doesn't own: the camera update that has
      // to happen before each paint.
      renderController.start(() => cameraController.update());

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

      const mountSettledRoot = (root: THREE.Object3D) => {
        prepareVehicleRoot(root, threeDConfig);
        root.updateWorldMatrix(true, true);
        const footprint = new THREE.Box3().setFromObject(root);
        if (contactShadow) {
          scene.remove(contactShadow);
          disposeContactShadow(contactShadow);
        }
        contactShadow = createContactShadow(footprint);
        scene.add(contactShadow);
        buildProceduralAccessories(root);
        scene.add(root);
        rootRef.current = root;
        groundedYRef.current = root.position.y;
        setSceneRevision((revision) => revision + 1);
        publishReady(root);
      };

      const wantsDetailedModel = Boolean(threeDConfig.hasModel && threeDConfig.modelUrl);

      if (!wantsDetailedModel) {
        progressive = reduceProgressiveLoad(progressive, { type: "no-model" });
        const root = createProceduralVehicle();
        if (cancelled) {
          disposeSubtree(root);
          return;
        }
        mountSettledRoot(root);
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
        rootRef.current = placeholder;
        groundedYRef.current = placeholder.position.y;
        setSceneRevision((revision) => revision + 1);

        progressive = reduceProgressiveLoad(progressive, { type: "start-loading" });
        canvasElement.dataset.loadPhase = progressive.phase;

        let detailed: THREE.Object3D | null = null;
        try {
          const modelStartedAt = performance.now();
          detailed = await loadVehicleRoot(threeDConfig, (fraction) => onProgressRef.current?.(fraction));
          // Download *and* Draco decode together, which is the number that matters: after
          // scripts/optimize-models.mjs took the payload to ~1.2 MiB, decode is expected to
          // dominate, and that is exactly the assumption worth checking against real devices.
          recordMetric({ name: "model_loaded", value: Math.round(performance.now() - modelStartedAt) });
          progressive = reduceProgressiveLoad(progressive, { type: "glb-decoded" });
        } catch (error) {
          console.error("High-detail glTF failed to load; using procedural fallback.", error);
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
          if (cancelled) {
            disposeSubtree(detailed);
            scene.remove(placeholder);
            disposeSubtree(placeholder);
            rootRef.current = null;
            return;
          }
          scene.remove(placeholder);
          disposeSubtree(placeholder);
          mountSettledRoot(detailed);
          progressive = reduceProgressiveLoad(progressive, { type: "settled" });
        } else {
          // Promote the placeholder to the permanent fallback root.
          scene.remove(placeholder);
          mountSettledRoot(placeholder);
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
        tier: renderController.currentQuality.tier,
        saveData: (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true,
        isSuspended: () => canvasElement.dataset.idle === "1",
      });
      prefetcher.start();

      // XR last: it needs the renderer, and there is nothing worth showing in AR until the vehicle
      // has actually settled into the scene.
      const xrController = new XrSessionController({
        renderer: renderController.renderer as unknown as ConstructorParameters<typeof XrSessionController>[0]["renderer"],
        onPresentingChange: (presenting) => {
          // The renderer's frame source has to change hands; `CameraController` must also stop
          // writing the camera, because in XR the device owns the pose entirely and an orbit tween
          // fighting head tracking is motion sickness, not a camera bug.
          renderController.setXrPresenting(presenting);
          cameraController.setControlsEnabled(!presenting);
          onXrPresentingChangeRef.current?.(presenting);
        },
        onError: (message) => onErrorRef.current(message),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time setup; see latest-value refs above.
  }, [threeDConfig]);

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
    renderControllerRef.current?.setQualityPreference(qualityPreference);
  }, [qualityPreference]);

  useEffect(() => {
    if (enterXrSignal === undefined) return;
    void xrControllerRef.current?.enter();
  }, [enterXrSignal]);

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
    if (!environmentController || !renderController || !hdriPresetId) return;
    // Supersession (a slower, superseded request's late-arriving result being discarded) is
    // EnvironmentController's own job now — see `applyHdri`'s doc comment — so this effect no
    // longer needs its own `cancelled` flag/cleanup for that race.
    void environmentController.applyHdri(renderController.renderer, hdriPresetId);
  }, [hdriPresetId, terrain, environmentPreset, sceneRevision]);

  return (
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
        "Escape to clear the selection. Click or tap a part directly to select it."
      }
    />
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
  onProgress?: (fraction: number) => void,
): Promise<THREE.Object3D> {
  if (!threeDConfig.hasModel || !threeDConfig.modelUrl) return createProceduralVehicle();
  const gltf = await getGltfLoader().loadAsync(threeDConfig.modelUrl, (event) => {
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

  const mounts = threeDConfig.wheelMountNames.map((name) => root.getObjectByName(name));
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
    removeNode(root.getObjectByName(wheelNodeName));
    removeNode(root.getObjectByName(tireNodeName));

    const assembly = new THREE.Group();
    assembly.name = `AUTHORED_RUNNING_GEAR_${index}`;

    const tire = instantiateAsset(tireSource);
    tire.name = tireNodeName;
    const wheel = instantiateAsset(wheelSource);
    wheel.name = wheelNodeName;
    renameMaterials(wheel, index < 2 ? "wheel.metal" : "wheel.metal.001");

    assembly.add(tire, wheel);
    attachToMount(mounts[index]!, assembly, "authored-wheel-and-tire");
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

  for (const name of threeDConfig.hiddenNodeNames ?? []) {
    const node = root.getObjectByName(name);
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
  root.rotation.y = Math.PI;
}

function boundsOf(root: THREE.Object3D, nodeNames?: string[]): THREE.Box3 | null {
  root.updateWorldMatrix(true, true);

  if (!nodeNames?.length) return new THREE.Box3().setFromObject(root);

  const box = new THREE.Box3();
  let any = false;
  for (const name of nodeNames) {
    const node = root.getObjectByName(name);
    if (!node) continue;
    box.expandByObject(node);
    any = true;
  }
  return any ? box : new THREE.Box3().setFromObject(root);
}
