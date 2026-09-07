"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import * as THREE from "three";
import { applyHdriPreset, type HdriEnvironmentHandle } from "../../lib/three/hdriEnvironment";
import * as THREE_WEBGPU from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
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
  collectBrowserDeviceHints,
  resolveQuality,
  type QualitySettings,
} from "../../lib/three/quality";
import { createCanvasIdleGate } from "../../lib/three/canvasIdle";
import { FrameTimeTracker, formatFrameStats } from "../../lib/three/frameStats";
import {
  initialProgressiveState,
  reduceProgressiveLoad,
} from "../../lib/three/progressiveLoad";
import { QualityGovernor } from "../../lib/three/qualityGovernor";
import { motionDuration, prefersReducedMotion } from "../../lib/three/motionPreference";
import {
  createCinematicTour,
  type CinematicTour,
  type TourStatus,
} from "../../lib/three/cinematicTour";
import { installMetricsFlush, recordMetric } from "../../lib/observability/clientMetrics";

export type { TourStatus };
export type TourAction = { seq: number; type: "play" | "pause" | "cancel" };

export type CameraPreset = {
  id: string;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
};

/**
 * Radians per arrow-key press.
 *
 * ~7 degrees: coarse enough that circling the vehicle takes a reasonable number of presses (about
 * 52 for a full revolution, or a second of held key repeat), fine enough to line up on a detail
 * like a wheel or a badge.
 */
const KEYBOARD_ORBIT_STEP_RADIANS = 0.12;

/** Metres of dolly per +/- press, against the 4-15 m distance range OrbitControls is clamped to. */
const KEYBOARD_ZOOM_STEP = 0.6;

export type Terrain = "Studio" | "Trail" | "Night";
export type EnvironmentPreset = "Daytime" | "Sunset" | "Night";

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

export function VehicleCanvas({ threeDConfig, slug, catalog, cameraPreset, lift, terrain, environmentPreset, hdriPresetId, onReady, onError, onProgress, tourAction, onTourStatusChange, onTourStep, onPartHover, onPartSelect }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const tourRef = useRef<CinematicTour | null>(null);
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
  const environmentRef = useRef<EnvironmentRefs | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const hdriHandleRef = useRef<HdriEnvironmentHandle | null>(null);

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
  }, [cameraPreset, catalog, onError, onProgress, onReady, onTourStatusChange, onTourStep, onPartHover, onPartSelect]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const host = hostRef.current;
      if (!host) return;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#0b0f14");
      scene.fog = new THREE.Fog("#0b0f14", 16, 32);

      const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
      camera.position.set(...cameraPreset.position);
      cameraRef.current = camera;

      let quality = resolveQuality(collectBrowserDeviceHints());
      const { renderer, mode } = await createRenderer(quality.antialias);
      if (cancelled) {
        renderer.dispose();
        return;
      }
      // Paint-studio HDRI (PMREM) needs the live renderer; WebGPU skips the HDR file path.
      rendererRef.current = renderer as unknown as THREE.WebGLRenderer;

      applyRendererQuality(renderer, quality);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.domElement.dataset.renderer = mode;
      recordMetric({ name: "renderer_selected", labels: { renderer: mode, tier: quality.tier } });
      renderer.domElement.dataset.quality = quality.tier;
      host.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      // Damping is inertia: the scene keeps moving after the user stops dragging. That is exactly
      // the "motion I did not ask for and cannot stop" the reduced-motion preference covers, so it
      // is a preference check rather than a constant.
      controls.enableDamping = !prefersReducedMotion();
      controls.minDistance = 4;
      controls.maxDistance = 15;
      controls.maxPolarAngle = Math.PI * 0.49;
      controls.target.set(...cameraPreset.target);
      controlsRef.current = controls;

      // Cinematic tour seizes these controls while playing; pointer/wheel on the canvas cancels.
      tourRef.current = createCinematicTour(
        {
          cameraPosition: camera.position,
          cameraTarget: controls.target,
          setControlsEnabled: (enabled) => {
            controls.enabled = enabled;
          },
          domElement: renderer.domElement,
        },
        threeDConfig.cameraPresets,
        {
          onStatusChange: (status) => {
            tourActiveRef.current = status !== "idle";
            onTourStatusChangeRef.current?.(status);
          },
          onStep: (preset) => {
            onTourStepRef.current?.(preset);
          },
        },
      );

      const hemi = new THREE.HemisphereLight("#edf5ff", "#18100b", 1.8);
      scene.add(hemi);

      // `bias`/`normalBias` avoid shadow acne without pulling the shadow away from the geometry
      // that casts it ("peter-panning") — too small and the floor self-shadows in moire bands, too
      // large and the vehicle's own contact shadow detaches from its tires, which is exactly the
      // "floating" artifact this tuning exists to prevent. The explicit frustum is sized to the
      // largest catalog vehicle (the AE86, ~9m long) rather than three's default ±5 box, which
      // clipped shadow coverage for anything longer than a compact car.
      const key = new THREE.DirectionalLight("#ffffff", 4.2);
      key.position.set(6, 9, 7);
      key.castShadow = quality.shadowsEnabled;
      key.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      key.shadow.bias = -0.00018;
      key.shadow.normalBias = 0.025;
      key.shadow.camera.near = 1;
      key.shadow.camera.far = 30;
      key.shadow.camera.left = -11;
      key.shadow.camera.right = 11;
      key.shadow.camera.top = 11;
      key.shadow.camera.bottom = -11;
      key.shadow.camera.updateProjectionMatrix();
      scene.add(key);

      // Raised and dimmed relative to the original rig: at the old (-7, 4, -6) grazing angle this
      // blue rim light hit the glossy floor almost edge-on and blew out into a large unshadowed
      // specular hotspot that read as a glow the vehicle was floating in, drowning out the contact
      // shadow underneath it. Steepening the angle and tempering the floor material below (both
      // parts of the same fix) let the actual shadow read again.
      const rim = new THREE.DirectionalLight("#4169ff", 1.6 * quality.secondaryLightScale);
      rim.position.set(-6, 7.5, -6);
      scene.add(rim);

      // Fills the shaded (camera-facing, key-light-averted) side so the vehicle doesn't render as a
      // near-silhouette — the previous two-light rig left everything but the lit flank close to
      // black. No shadow: this is a soft bounce-light stand-in, not a directional key.
      const fill = new THREE.DirectionalLight("#dce8ff", 1.1 * quality.secondaryLightScale);
      fill.position.set(-2, 3, 9);
      scene.add(fill);

      // Lower clearcoat/higher roughness than before: the prior floor was mirror-glossy enough that
      // the rim light's specular reflection alone could out-shine the actual shadow beneath the
      // vehicle. A duller showroom floor lets contact shadows read as the primary grounding cue.
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(50, 50),
        new THREE.MeshPhysicalMaterial({ color: "#0a0c10", roughness: 0.6, metalness: 0.05, clearcoat: 0.12, clearcoatRoughness: 0.4 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = quality.shadowsEnabled;
      scene.add(floor);

      const grid = new THREE.GridHelper(36, 36, "#26303a", "#151a20");
      grid.position.y = 0.002;
      scene.add(grid);

      const stars = createStarfield(quality.starfieldCount);
      stars.visible = false;
      scene.add(stars);

      const rocks = createTrailRocks();
      rocks.visible = false;
      scene.add(rocks);

      const environment = { scene, floor, grid, hemi, key, rim, fill, stars, rocks };
      environmentRef.current = environment;
      applyEnvironment(environment, terrain, environmentPreset);

      const resize = () => {
        const width = Math.max(host.clientWidth, 1);
        const height = Math.max(host.clientHeight, 1);
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      resize();
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);

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
        // spherical write never fight over camera.position for a frame.
        if (tourRef.current && tourRef.current.status !== "idle") {
          tourRef.current.cancel();
        }

        const offset = camera.position.clone().sub(controls.target);
        const spherical = new THREE.Spherical().setFromVector3(offset);

        switch (event.key) {
          case "ArrowLeft":
            spherical.theta -= KEYBOARD_ORBIT_STEP_RADIANS;
            break;
          case "ArrowRight":
            spherical.theta += KEYBOARD_ORBIT_STEP_RADIANS;
            break;
          case "ArrowUp":
            spherical.phi -= KEYBOARD_ORBIT_STEP_RADIANS;
            break;
          case "ArrowDown":
            spherical.phi += KEYBOARD_ORBIT_STEP_RADIANS;
            break;
          case "+":
          case "=":
            spherical.radius -= KEYBOARD_ZOOM_STEP;
            break;
          case "-":
          case "_":
            spherical.radius += KEYBOARD_ZOOM_STEP;
            break;
          case "Home":
            // Back to the active preset — a predictable escape hatch from an orbit the user has
            // lost their bearings in.
            camera.position.set(...cameraPresetRef.current.position);
            controls.target.set(...cameraPresetRef.current.target);
            controls.update();
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

        // The same clamps OrbitControls applies to pointer input. `phi` additionally avoids exactly
        // 0, where the camera's up-vector becomes degenerate and the view flips.
        spherical.phi = Math.min(Math.max(spherical.phi, 0.05), controls.maxPolarAngle);
        spherical.radius = Math.min(
          Math.max(spherical.radius, controls.minDistance),
          controls.maxDistance,
        );

        camera.position.copy(offset.setFromSpherical(spherical).add(controls.target));
        controls.update();
        // Only after a key was actually handled — an unrecognised key already returned above, so
        // page scrolling and browser shortcuts are left alone.
        event.preventDefault();
      };
      host.addEventListener("keydown", handleKeyDown);

      /**
       * WebGL context loss.
       *
       * The GPU process can drop a context at any time — a driver reset, the OS reclaiming VRAM, a
       * background tab being evicted, too many live contexts. It arrives as an *event*, not an
       * exception, so neither the try/catch around model loading nor `CanvasErrorBoundary` sees it:
       * the render loop just keeps calling into a dead context and the viewport freezes on its last
       * frame with nothing logged anywhere.
       *
       * `preventDefault` on `webglcontextlost` is what makes the context eligible for restoration at
       * all — without it the browser never fires `webglcontextrestored`.
       */
      const canvasElement = renderer.domElement;
      const handleContextLost = (event: Event) => {
        event.preventDefault();
        running = false;
        cancelPendingRaf();
        console.warn("[canvas] WebGL context lost; pausing render loop until it is restored.");
        onErrorRef.current("Rendering was interrupted. Attempting to recover the 3D view.");
      };
      const handleContextRestored = () => {
        console.info("[canvas] WebGL context restored; resuming render loop.");
        // Reallocates the drawing buffer against the restored context; without it the renderer keeps
        // the dimensions of a buffer that no longer exists.
        resize();
        if (running) return;
        running = true;
        frameStats.reset();
        governor.reset();
        loop?.();
      };
      canvasElement.addEventListener("webglcontextlost", handleContextLost);
      canvasElement.addEventListener("webglcontextrestored", handleContextRestored);

      const uninstallMetricsFlush = installMetricsFlush();

      // Start the render loop before the ~28 MiB GLB settles so the placeholder paints immediately.
      let running = true;
      let suspended = false;
      let contactShadow: THREE.Mesh | null = null;
      let controller: VehicleSceneController | null = null;
      const frameStats = new FrameTimeTracker(60);

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
        requestAnimationFrame(() => {
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

      /**
       * Applies a quality tier to the live renderer and scene.
       *
       * `resolveQuality` picks a tier once from device hints; this is what makes that choice
       * revisable mid-session (the adaptive policy `lib/three/quality.ts` defers to issue #33).
       * Everything a tier controls that can be changed after construction is re-applied here.
       *
       * `antialias` and `loadAuthoredRunningGear` deliberately are not: antialias is fixed at
       * renderer construction and changing it would mean tearing down the WebGL context mid-
       * session, and the running gear is either already mounted or already skipped. Both settle at
       * the opening tier, which is the right trade — the expensive, adjustable knobs are pixel
       * ratio and shadows, and those are the ones that move.
       */
      const applyTier = (next: QualitySettings) => {
        quality = next;
        applyRendererQuality(renderer, next);
        renderer.domElement.dataset.quality = next.tier;
        key.castShadow = next.shadowsEnabled;
        if (next.shadowsEnabled) {
          key.shadow.mapSize.set(next.shadowMapSize, next.shadowMapSize);
          // three caches the shadow render target and will not reallocate it just because mapSize
          // changed, so without this the new resolution is stored and never takes effect — the
          // expensive half of a downgrade would silently do nothing.
          key.shadow.map?.dispose();
          key.shadow.map = null;
        }
        floor.receiveShadow = next.shadowsEnabled;
        rim.intensity = 1.6 * next.secondaryLightScale;
        fill.intensity = 1.1 * next.secondaryLightScale;
        resize();
      };

      const governor = new QualityGovernor({
        initialTier: quality.tier,
        onChange: (next, { from, reason }) => {
          applyTier(next);
          recordMetric({
            name: "quality_changed",
            value: Math.round(governor.averageFrameTimeMs),
            labels: { from, to: next.tier, reason },
          });
          // Left in production rather than dev-gated: when someone reports "the showroom looks
          // blurry on my phone", this line is the answer, and it fires a handful of times a session.
          console.info(`[quality] ${reason}: ${from} -> ${next.tier}`);
        },
      });
      let loop: (() => void) | undefined;
      /** Pending rAF handle — must be cancelled on idle/suspend/cleanup to avoid forked loops. */
      let rafId = 0;
      /** Monotonic publish counter; `stats.samples` caps at the ring size so it cannot throttle. */
      let framePublishCount = 0;

      const cancelPendingRaf = () => {
        if (rafId !== 0) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
      };

      const queueFrame = () => {
        if (rafId !== 0) return;
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          loop?.();
        });
      };

      const idleGate = createCanvasIdleGate(host, (next) => {
        suspended = next;
        renderer.domElement.dataset.idle = next ? "1" : "0";
        if (next) {
          cancelPendingRaf();
          return;
        }
        // Leaving idle: drop any stale rAF, reseed frame timing, and kick a single chain.
        if (running) {
          cancelPendingRaf();
          frameStats.reset();
          // The frames either side of an idle gap describe the pause, not the renderer; feeding
          // them to the governor would drive a downgrade on resume.
          governor.reset();
          loop?.();
        }
      });
      suspended = idleGate.suspended;
      renderer.domElement.dataset.idle = suspended ? "1" : "0";

      loop = () => {
        if (!running) return;
        if (suspended) return;
        const stats = frameStats.record(performance.now());
        // Reuses the delta frameStats already computed rather than timing the loop a second time.
        governor.recordFrame(stats.lastFrameMs);
        framePublishCount += 1;
        if (stats.samples > 0 && framePublishCount % 30 === 0) {
          renderer.domElement.dataset.frameStats = formatFrameStats(stats);
        }
        controls.update();
        const paint = renderer.renderAsync
          ? renderer.renderAsync(scene, camera)
          : Promise.resolve(renderer.render(scene, camera));
        void paint.finally(() => {
          if (running && !suspended) queueFrame();
        });
      };
      loop();

      // Assign cleanup before any await so an unmount mid-load still tears the renderer down.
      cleanup = () => {
        running = false;
        cancelPendingRaf();
        uninstallMetricsFlush();
        tourRef.current?.dispose();
        tourRef.current = null;
        tourActiveRef.current = false;
        host.removeEventListener("keydown", handleKeyDown);
        canvasElement.removeEventListener("webglcontextlost", handleContextLost);
        canvasElement.removeEventListener("webglcontextrestored", handleContextRestored);
        canvasElement.removeEventListener("pointerdown", handlePointerDown);
        canvasElement.removeEventListener("pointermove", handlePointerMove);
        canvasElement.removeEventListener("pointerup", handlePointerUp);
        canvasElement.removeEventListener("pointerleave", handlePointerLeave);
        canvasElement.removeEventListener("pointercancel", handlePointerLeave);
        idleGate.dispose();
        resizeObserver.disconnect();
        hdriHandleRef.current?.dispose();
        hdriHandleRef.current = null;
        rendererRef.current = null;
        controls.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        if (controller) {
          controller.dispose();
        } else if (rootRef.current) {
          // Placeholder (or unsettled root) is not owned by the controller yet.
          scene.remove(rootRef.current);
          disposeSubtree(rootRef.current);
        }
        floor.geometry.dispose();
        (floor.material as THREE.Material).dispose();
        grid.dispose();
        disposeStarfield(stars);
        disposeTrailRocks(rocks);
        if (contactShadow) disposeContactShadow(contactShadow);
        rootRef.current = null;
      };

      if (import.meta.env.DEV) {
        (window as unknown as Record<string, unknown>).__vehicleFrameStats = () => frameStats.snapshot();
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
        renderer.domElement.dataset.loadPhase = progressive.phase;

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

        renderer.domElement.dataset.loadPhase = progressive.phase;

        if (detailed && progressive.hasDetailedModel) {
          if (quality.loadAuthoredRunningGear) {
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

      renderer.domElement.dataset.loadPhase = progressive.phase;
      if (import.meta.env.DEV) {
        (window as unknown as Record<string, unknown>).__vehicleProgressiveLoad = progressive;
        (window as unknown as Record<string, unknown>).__vehicleQuality = quality;
      }

      // cleanup already assigned above (before GLB await).
    })().catch((error) => {
      console.error("Vehicle scene initialization failed:", error);
      onErrorRef.current(error instanceof Error ? error.message : String(error));
    });

    return () => {
      cancelled = true;
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
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    // Tour owns the same vectors via its timeline; a toolbar highlight update from onTourStep must
    // not start a parallel tween that fights it.
    if (tourActiveRef.current) return;

    // The longest movement on the stage, and the one most likely to provoke motion sickness: the
    // camera swings bodily across the scene. Under reduced motion it cuts, preserving the
    // destination without the journey.
    const duration = motionDuration(0.85);
    gsap.to(camera.position, {
      x: cameraPreset.position[0],
      y: cameraPreset.position[1],
      z: cameraPreset.position[2],
      duration,
      ease: "power3.inOut",
    });
    gsap.to(controls.target, {
      x: cameraPreset.target[0],
      y: cameraPreset.target[1],
      z: cameraPreset.target[2],
      duration,
      ease: "power3.inOut",
    });
  }, [cameraPreset]);

  // Builder chrome play/pause/cancel — seq bumps so repeated identical actions still fire.
  useEffect(() => {
    if (!tourAction) return;
    const tour = tourRef.current;
    if (!tour) return;
    if (tourAction.type === "play") tour.play();
    else if (tourAction.type === "pause") tour.pause();
    else tour.cancel();
  }, [tourAction]);

  useEffect(() => {
    // Keep the tour path in sync if the vehicle's catalog presets change (vehicle switch remounts
    // the canvas via threeDConfig, but setPresets is cheap insurance for hot catalog edits).
    tourRef.current?.setPresets(threeDConfig.cameraPresets);
  }, [threeDConfig.cameraPresets]);

  useEffect(() => {
    if (environmentRef.current) applyEnvironment(environmentRef.current, terrain, environmentPreset);
  }, [terrain, environmentPreset]);

  useEffect(() => {
    const environment = environmentRef.current;
    const renderer = rendererRef.current;
    if (!environment || !renderer || !hdriPresetId) return;
    let cancelled = false;
    void applyHdriPreset(
      {
        scene: environment.scene,
        hemi: environment.hemi,
        key: environment.key,
        rim: environment.rim,
        fill: environment.fill,
      },
      renderer,
      hdriPresetId,
      hdriHandleRef.current,
    ).then((handle) => {
      if (cancelled) {
        handle?.dispose();
        return;
      }
      hdriHandleRef.current = handle;
    });
    return () => {
      cancelled = true;
    };
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

type EnvironmentRefs = {
  scene: THREE.Scene;
  floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
  grid: THREE.GridHelper;
  hemi: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  stars: THREE.Points;
  rocks: THREE.Group;
};

function applyEnvironment(environment: EnvironmentRefs, terrain: Terrain, preset: EnvironmentPreset): void {
  const palette = preset === "Night"
    ? { bg: "#050813", floor: "#0b0d15", sky: "#33436c", ground: "#080a12", keyColor: "#b8c9ff", rimColor: "#4169ff", fillColor: "#26314f", key: 1.0, rim: 1.7, fill: 0.5, hemi: 1.1 }
    : preset === "Sunset"
      ? { bg: "#21140f", floor: "#1c130f", sky: "#ffd3a1", ground: "#5e3023", keyColor: "#ffb36b", rimColor: "#ff5a36", fillColor: "#ffdcb0", key: 2.6, rim: 1.4, fill: 0.9, hemi: 1.6 }
      : { bg: terrain === "Trail" ? "#152017" : "#0b0f14", floor: terrain === "Trail" ? "#191712" : "#0a0c10", sky: "#edf5ff", ground: "#18100b", keyColor: "#ffffff", rimColor: "#4169ff", fillColor: "#dce8ff", key: 4.2, rim: 1.6, fill: 1.1, hemi: 1.8 };
  environment.scene.background = new THREE.Color(palette.bg);
  environment.scene.fog = new THREE.Fog(palette.bg, terrain === "Trail" ? 10 : 16, terrain === "Trail" ? 25 : 32);
  environment.floor.material.color.set(palette.floor);
  environment.hemi.color.set(palette.sky);
  environment.hemi.groundColor.set(palette.ground);
  environment.hemi.intensity = palette.hemi;
  environment.key.color.set(palette.keyColor);
  environment.key.intensity = palette.key;
  environment.rim.color.set(palette.rimColor);
  environment.rim.intensity = palette.rim;
  environment.fill.color.set(palette.fillColor);
  environment.fill.intensity = palette.fill;
  environment.grid.visible = terrain === "Studio";
  // Both are static set dressing, not physically part of any vehicle, so they're built once at
  // scene setup and simply shown or hidden here rather than rebuilt per preset switch.
  environment.stars.visible = preset === "Night";
  environment.rocks.visible = terrain === "Trail";
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

/** A fixed field of distant points, shown only for the Night preset — cheap set dressing that
 * sells the "outdoor at night" read the flat dark background alone doesn't. */
function createStarfield(count = 400): THREE.Points {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const radius = 32 + Math.random() * 14;
    const theta = Math.random() * Math.PI * 2;
    // Restricted to the upper hemisphere (elevation 0.1–1) so stars never land below the horizon,
    // where the floor plane would occlude them anyway.
    const elevation = 0.1 + Math.random() * 0.9;
    const y = radius * elevation;
    const ring = Math.sqrt(Math.max(radius * radius - y * y, 0));
    positions[i * 3] = Math.cos(theta) * ring;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(theta) * ring;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: "#e7edff",
    size: 0.12,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.85,
    toneMapped: false,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = "STARFIELD";
  return points;
}

function disposeStarfield(points: THREE.Points): void {
  points.geometry.dispose();
  (points.material as THREE.Material).dispose();
}

/** Low-poly rocks scattered around the vehicle, shown only for the Trail terrain preview — the
 * flat studio floor otherwise looks the same regardless of which terrain is "selected". Positions
 * are hand-placed (not randomised) and kept outside the ~2.5m the camera presets orbit within, so
 * they read as surrounding terrain rather than debris crowding the vehicle. */
function createTrailRocks(): THREE.Group {
  const group = new THREE.Group();
  group.name = "TRAIL_ROCKS";
  const material = new THREE.MeshStandardMaterial({ color: "#3a352e", roughness: 0.95, metalness: 0.02, flatShading: true });

  const placements: [number, number, number, number][] = [
    [-3.4, 0.22, -2.1, 0.34],
    [-3.9, 0.16, 0.6, 0.24],
    [3.6, 0.2, -1.4, 0.3],
    [4.1, 0.14, 1.6, 0.22],
    [-2.6, 0.12, 3.3, 0.2],
    [2.9, 0.15, 3.6, 0.24],
    [-4.4, 0.18, -3.4, 0.28],
    [4.6, 0.13, -3.8, 0.2],
  ];
  for (const [x, y, z, scale] of placements) {
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), material);
    rock.scale.set(scale, scale * (0.7 + (x % 1 === 0 ? 0 : 0.2)), scale);
    rock.position.set(x, y, z);
    rock.rotation.set(x * 0.7, z * 0.5, x * z * 0.1);
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
  }
  return group;
}

function disposeTrailRocks(group: THREE.Group): void {
  const material = (group.children[0] as THREE.Mesh | undefined)?.material as THREE.Material | undefined;
  material?.dispose();
  for (const child of group.children) {
    if (child instanceof THREE.Mesh) child.geometry.dispose();
  }
}

type RendererLike = {
  domElement: HTMLCanvasElement;
  setPixelRatio(value: number): void;
  setSize(width: number, height: number): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  renderAsync?: (scene: THREE.Scene, camera: THREE.Camera) => Promise<void>;
  dispose(): void;
  shadowMap: { enabled: boolean };
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
};

function applyRendererQuality(renderer: RendererLike, quality: QualitySettings): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio));
  renderer.shadowMap.enabled = quality.shadowsEnabled;
}

async function createRenderer(antialias: boolean): Promise<{ renderer: RendererLike; mode: "webgpu" | "webgl2" }> {
  if (navigator.gpu) {
    try {
      const renderer = new THREE_WEBGPU.WebGPURenderer({ antialias });
      await renderer.init();
      return { renderer: renderer as unknown as RendererLike, mode: "webgpu" };
    } catch (error) {
      console.warn("WebGPU initialization failed; using WebGL2 fallback.", error);
    }
  }

  const renderer = new THREE.WebGLRenderer({ antialias, alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return { renderer: renderer as unknown as RendererLike, mode: "webgl2" };
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
