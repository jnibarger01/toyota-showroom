"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import * as THREE from "three";
import * as THREE_WEBGPU from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Vehicle3DConfig } from "../../lib/types/vehicle";
import type { CustomizationOption } from "../../lib/types/customization";
import { VehicleSceneController } from "../../lib/three/sceneController";
import { attachToMount, getGltfLoader, instantiateAsset, loadAsset, disposeSubtree } from "../../lib/three/assets";
import { logHierarchy, verifyNodeContract } from "../../lib/three/nodes";
import { buildProceduralAccessories, createProceduralVehicle } from "../../lib/three/proceduralParts";
import { QUALITY_TIERS, QualityGovernor, suggestInitialTierIndex, type QualityTier } from "../../lib/three/qualityGovernor";
import { motionDuration, prefersReducedMotion } from "../../lib/three/motionPreference";

export type CameraPreset = {
  id: string;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
};

export type Terrain = "Studio" | "Trail" | "Night";
export type EnvironmentPreset = "Daytime" | "Sunset" | "Night";

type Props = {
  threeDConfig: Vehicle3DConfig;
  /** Full server catalog. Only the options this GLB can satisfy are handed back via `onReady`. */
  catalog: CustomizationOption[];
  cameraPreset: CameraPreset;
  /** Ride-height offset in inches; not a catalog category, so it stays a plain prop. */
  lift: number;
  terrain: Terrain;
  environmentPreset: EnvironmentPreset;
  /**
   * Fired once the model is loaded, cleaned up, and verified. The controller is the caller's
   * handle for every subsequent scene mutation — the canvas itself never applies an option.
   */
  onReady: (controller: VehicleSceneController, applicable: CustomizationOption[]) => void;
  onError: (message: string) => void;
  /**
   * Download progress for the main vehicle asset, 0..1. Optional, and deliberately not a
   * substitute for `onReady`: the showroom is already rendering while this fires, so it drives a
   * progress affordance, not a blocking spinner.
   *
   * Only reported when the server sends `Content-Length`. A Draco-compressed GLB served with
   * `Content-Encoding: gzip` often does not, and inventing a fake percentage in that case is worse
   * than showing none — so the callback simply does not fire.
   */
  onProgress?: (fraction: number) => void;
};

export function VehicleCanvas({ threeDConfig, catalog, cameraPreset, lift, terrain, environmentPreset, onReady, onError, onProgress }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rootRef = useRef<THREE.Object3D | null>(null);
  /** Grounded `position.y` from `prepareVehicleRoot`; lift is applied relative to it. */
  const groundedYRef = useRef(0);
  /**
   * Bumped once the model is in the scene. The lift effect depends on it so the initial ride height
   * is applied when the root appears — otherwise the effect runs only while the GLB is still
   * loading, finds no root, and never reruns because `lift` itself has not changed.
   */
  const [sceneRevision, setSceneRevision] = useState(0);
  const environmentRef = useRef<EnvironmentRefs | null>(null);

  // Latest-value refs: the setup effect must run exactly once (re-fetching and re-decoding the GLB on every
  // prop change is the thing this integration exists to avoid), so it reads callbacks through refs
  // rather than listing them as dependencies. The assignment happens in an effect, not inline during
  // render — writing to `ref.current` while rendering is an impure side effect React disallows (the
  // render function may run more than once before committing); an effect runs only after commit.
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const onProgressRef = useRef(onProgress);
  const catalogRef = useRef(catalog);
  // Read by the Home-key handler, which lives in the run-once setup effect and so cannot close
  // over the prop directly — it would reset to whichever preset was active at mount.
  const cameraPresetRef = useRef(cameraPreset);
  useEffect(() => {
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
    onProgressRef.current = onProgress;
    catalogRef.current = catalog;
    cameraPresetRef.current = cameraPreset;
  }, [cameraPreset, catalog, onError, onProgress, onReady]);

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

      const { renderer, mode } = await createRenderer();
      if (cancelled) {
        renderer.dispose();
        return;
      }

      // Current quality rung. `resize` reads this rather than closing over a constant, so a tier
      // change landing between resizes is not undone by the next one. Seeded with the top tier and
      // replaced by `applyTier(governor.tier)` once the governor exists.
      let activeTier: QualityTier = QUALITY_TIERS[0]!;
      renderer.shadowMap.enabled = true;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.domElement.dataset.renderer = mode;
      host.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      // Damping is inertia: the scene keeps moving after the user stops dragging. That is exactly
      // the "motion I did not ask for and cannot stop" that the reduced-motion preference covers,
      // so it is a preference check rather than a constant.
      controls.enableDamping = !prefersReducedMotion();
      controls.minDistance = 4;
      controls.maxDistance = 15;
      controls.maxPolarAngle = Math.PI * 0.49;
      controls.target.set(...cameraPreset.target);
      controlsRef.current = controls;

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
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
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
      const rim = new THREE.DirectionalLight("#4169ff", 1.6);
      rim.position.set(-6, 7.5, -6);
      scene.add(rim);

      // Fills the shaded (camera-facing, key-light-averted) side so the vehicle doesn't render as a
      // near-silhouette — the previous two-light rig left everything but the lit flank close to
      // black. No shadow: this is a soft bounce-light stand-in, not a directional key.
      const fill = new THREE.DirectionalLight("#dce8ff", 1.1);
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
      floor.receiveShadow = true;
      scene.add(floor);

      const grid = new THREE.GridHelper(36, 36, "#26303a", "#151a20");
      grid.position.y = 0.002;
      scene.add(grid);

      const stars = createStarfield();
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
        // Re-applied on every resize, not just on tier change: `setSize` reallocates the drawing
        // buffer using whatever pixel ratio is currently set, so a stale ratio here would silently
        // undo the governor's last decision the first time the window changed size.
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, activeTier.pixelRatioCap));
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };

      /**
       * Applies a quality tier to the live renderer.
       *
       * Shadow map resizing needs the explicit dispose: three caches the render target on
       * `light.shadow.map` and does not reallocate it just because `mapSize` changed, so without
       * this the new resolution is stored but never takes effect — the expensive half of a
       * downgrade would silently do nothing.
       */
      const applyTier = (tier: QualityTier) => {
        activeTier = tier;
        const castsShadows = tier.shadowMapSize > 0;
        renderer.shadowMap.enabled = castsShadows;
        key.castShadow = castsShadows;
        if (castsShadows) {
          key.shadow.mapSize.set(tier.shadowMapSize, tier.shadowMapSize);
          key.shadow.map?.dispose();
          key.shadow.map = null;
        }
        // Runs setPixelRatio and setSize together; setting the ratio alone would leave the drawing
        // buffer at its previous dimensions until something else happened to trigger a resize.
        resize();
      };

      const governor = new QualityGovernor({
        initialTierIndex: suggestInitialTierIndex(),
        onChange: (tier, { from, reason }) => {
          applyTier(tier);
          // Left in production rather than dev-gated: when someone reports "the showroom looks
          // blurry on my phone", this line is the answer, and it fires at most a handful of times
          // in a session.
          console.info(
            `[quality] ${reason}: ${from.id} -> ${tier.id} ` +
              `(dpr cap ${tier.pixelRatioCap}, shadow map ${tier.shadowMapSize || "off"})`,
          );
        },
      });

      // Applies the *opening* tier, which `suggestInitialTierIndex` may already have set below the
      // top rung. Assigning `activeTier` alone would leave the shadow map at the 2048² default
      // while the pixel ratio reflected a lower tier — half-configured, and hard to spot.
      applyTier(governor.tier);

      /**
       * Keyboard orbit, zoom, and reset.
       *
       * OrbitControls' own `listenToKeyEvents` binds the arrow keys to *panning*, which slides the
       * whole scene sideways and is close to useless for inspecting a vehicle — the thing a user
       * wants from the arrows here is to walk around it. So the orbit is computed directly, in
       * spherical coordinates about the control target, honouring the same polar and distance
       * limits the mouse path is constrained by. Without this the entire 3D stage was reachable by
       * pointer only.
       */
      const handleKeyDown = (event: KeyboardEvent) => {
        // Never swallow a modified key: those are browser and OS shortcuts, and stealing Cmd/Ctrl+
        // arrow from a keyboard user is a worse bug than the one this is fixing.
        if (event.altKey || event.ctrlKey || event.metaKey) return;

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
            // Back to the active preset, which is where the camera effect would put it anyway —
            // a predictable escape hatch from an orbit the user has lost their bearings in.
            camera.position.set(...cameraPresetRef.current.position);
            controls.target.set(...cameraPresetRef.current.target);
            controls.update();
            event.preventDefault();
            return;
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
        // Only after a key was actually handled — an unrecognised key has already returned above,
        // so page scrolling and browser shortcuts are left alone.
        event.preventDefault();
      };
      host.addEventListener("keydown", handleKeyDown);

      /**
       * WebGL context loss.
       *
       * The GPU process can drop a context at any time — a driver reset, the OS reclaiming VRAM,
       * a background tab being evicted, or simply too many live contexts across the browser. It
       * arrives as an *event*, not an exception, so neither the try/catch around model loading nor
       * `CanvasErrorBoundary` sees it: the render loop just keeps calling into a dead context and
       * the viewport freezes on its last frame with no error anywhere.
       *
       * `preventDefault` on `webglcontextlost` is what makes the context eligible for restoration
       * at all — without it the browser will never fire `webglcontextrestored`. The loop is stopped
       * meanwhile because drawing into a lost context is wasted work that also spams the console.
       */
      const canvas = renderer.domElement;
      const handleContextLost = (event: Event) => {
        event.preventDefault();
        running = false;
        console.warn("[canvas] WebGL context lost; pausing render loop until it is restored.");
        onErrorRef.current("Rendering was interrupted. Attempting to recover the 3D view.");
      };
      const handleContextRestored = () => {
        console.info("[canvas] WebGL context restored; resuming render loop.");
        // `resize` reallocates the drawing buffer against the restored context; without it the
        // renderer keeps the dimensions of a buffer that no longer exists.
        resize();
        if (running) return;
        running = true;
        lastFrameAt = performance.now();
        void loop();
      };
      canvas.addEventListener("webglcontextlost", handleContextLost);
      canvas.addEventListener("webglcontextrestored", handleContextRestored);

      const observer = new ResizeObserver(resize);
      observer.observe(host);

      // The render loop starts here — before any vehicle geometry exists — rather than after the
      // model resolves. Previously nothing was drawn until the full GLB had downloaded, decoded,
      // and been verified, so the whole showroom (lights, floor, grid, environment) sat behind a
      // spinner waiting on geometry it does not depend on. Starting now means first paint is
      // bounded by renderer setup instead of by the largest asset on the page.
      let running = true;
      let lastFrameAt = performance.now();
      const loop = async () => {
        if (!running) return;
        const frameStartedAt = performance.now();
        governor.recordFrame(frameStartedAt - lastFrameAt);
        lastFrameAt = frameStartedAt;
        controls.update();
        if (renderer.renderAsync) await renderer.renderAsync(scene, camera);
        else renderer.render(scene, camera);
        requestAnimationFrame(loop);
      };
      void loop();

      // Teardown is registered here, the moment there is anything to tear down, and extended as
      // later resources appear. It used to be assigned only after the model resolved, which meant
      // an unmount during loading — a route change, React 18 strict-mode's double effect — leaked
      // the renderer, its WebGL context, the resize observer, and a render loop that kept running
      // against a detached canvas. Starting the loop before the model made that window much wider,
      // so the ordering is deliberate rather than incidental.
      const disposers: Array<() => void> = [
        () => {
          running = false;
          host.removeEventListener("keydown", handleKeyDown);
          canvas.removeEventListener("webglcontextlost", handleContextLost);
          canvas.removeEventListener("webglcontextrestored", handleContextRestored);
          observer.disconnect();
          controls.dispose();
          renderer.dispose();
          renderer.domElement.remove();
          floor.geometry.dispose();
          (floor.material as THREE.Material).dispose();
          grid.dispose();
          disposeStarfield(stars);
          disposeTrailRocks(rocks);
          rootRef.current = null;
        },
      ];
      // Run in reverse: later resources are built on earlier ones, so they must go first.
      cleanup = () => {
        for (const dispose of [...disposers].reverse()) dispose();
      };

      /**
       * Low-detail stand-in shown while the real model streams in.
       *
       * `createProceduralVehicle` is already this project's failure fallback, so reusing it as the
       * loading proxy costs nothing and inherits its coverage. It is display-only: it is never
       * handed to a `VehicleSceneController`, never verified against the catalog, and no option is
       * ever applied to it. That keeps the swap below a pure visual substitution rather than a
       * second lifecycle the store would have to reason about.
       */
      const proxy = createProceduralVehicle();
      proxy.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        // Cloned so dimming the placeholder cannot touch materials the real vehicle may share.
        const material = (object.material as THREE.Material).clone();
        material.transparent = true;
        material.opacity = PROXY_OPACITY;
        object.material = material;
      });
      scene.add(proxy);
      // Registered immediately: between here and the swap below, the proxy is the only vehicle in
      // the scene, and `disposeProxy` is a no-op once the swap has already released it.
      disposers.push(() => disposeProxy(proxy));
      rootRef.current = proxy;
      groundedYRef.current = proxy.position.y;

      let root: THREE.Object3D;
      let usingFallback = false;
      try {
        root = await loadVehicleRoot(threeDConfig, (fraction) => onProgressRef.current?.(fraction));
      } catch (error) {
        console.error("High-detail glTF failed to load; using procedural fallback.", error);
        onErrorRef.current("The detailed model could not be loaded. Showing a simplified vehicle.");
        root = createProceduralVehicle();
        usingFallback = true;
      }
      if (cancelled) {
        disposeSubtree(root);
        return;
      }

      // Running gear is additive: the body is complete and correct without it, and it is four small
      // assets rather than one large one. Loading it *after* the body is in the scene means the
      // vehicle becomes visible a network round trip earlier, and a slow or failed running-gear
      // fetch degrades to the baked-in wheels instead of holding back the whole model.
      try {
        await installWheelAndTireAssets(root, threeDConfig);
      } catch (error) {
        // Replacement running gear is additive enhancement; retain the complete base model if an
        // optional glTF cannot be fetched or decoded.
        console.warn("[customization] supplied wheel and tyre glTFs could not be loaded.", error);
      }
      if (cancelled) {
        disposeSubtree(root);
        return;
      }
      prepareVehicleRoot(root, threeDConfig);

      // Measured before the (initially hidden) procedural accessories are attached, so a roof rack
      // or light bar sitting outside the body's own bounds never inflates the footprint this shadow
      // is sized to.
      root.updateWorldMatrix(true, true);
      const footprint = new THREE.Box3().setFromObject(root);
      const contactShadow = createContactShadow(footprint);
      scene.add(contactShadow);
      disposers.push(() => disposeContactShadow(contactShadow));

      buildProceduralAccessories(root);
      scene.add(root);

      // Swap the placeholder for the real vehicle. Both are in the scene for the length of the
      // fade, which is what keeps the transition from reading as a flash of empty showroom.
      // `usingFallback` skips the fade: the "real" model *is* another procedural vehicle in that
      // case, so cross-fading one into an identical copy would just look like a flicker.
      swapProxyForVehicle(proxy, usingFallback);

      rootRef.current = root;
      groundedYRef.current = root.position.y;
      setSceneRevision((revision) => revision + 1);

      if (import.meta.env.DEV) {
        (window as unknown as Record<string, unknown>).__dumpVehicleHierarchy = () => logHierarchy(root);
      }

      // Verify before handing the scene over, so an option whose nodes are absent is dropped from
      // the catalog rather than rendered as a button that would quietly do nothing.
      const report = verifyNodeContract(root, catalogRef.current);
      for (const entry of report.unsatisfied) {
        console.warn(
          `[customization] option "${entry.option.id}" is unavailable for this asset.`,
          { missingNodes: entry.missingNodes, missingMaterials: entry.missingMaterials },
        );
      }

      const controller = new VehicleSceneController(root, report.satisfied);
      onReadyRef.current(controller, report.satisfied);

      // The controller owns every material clone and attachment it made. It is last in, so the
      // reverse-order teardown releases it first — before the base scene geometry it borrows from.
      disposers.push(() => controller.dispose());
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

  useEffect(() => {
    if (environmentRef.current) applyEnvironment(environmentRef.current, terrain, environmentPreset);
  }, [terrain, environmentPreset]);

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
        "and Home to return to the selected camera angle."
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
function createStarfield(): THREE.Points {
  const count = 400;
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

async function createRenderer(): Promise<{ renderer: RendererLike; mode: "webgpu" | "webgl2" }> {
  if (navigator.gpu) {
    try {
      const renderer = new THREE_WEBGPU.WebGPURenderer({ antialias: true });
      await renderer.init();
      return { renderer: renderer as unknown as RendererLike, mode: "webgpu" };
    } catch (error) {
      console.warn("WebGPU initialization failed; using WebGL2 fallback.", error);
    }
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return { renderer: renderer as unknown as RendererLike, mode: "webgl2" };
}

/**
 * Radians per arrow-key press.
 *
 * ~7 degrees: coarse enough that circling the vehicle takes a reasonable number of presses (about
 * 52 for a full revolution, or a second or two of held key repeat), fine enough to line up on a
 * detail like a wheel or a badge.
 */
const KEYBOARD_ORBIT_STEP_RADIANS = 0.12;

/** Metres of dolly per +/- press, against the 4-15 m distance range OrbitControls is clamped to. */
const KEYBOARD_ZOOM_STEP = 0.6;

/**
 * Opacity of the low-detail placeholder shown while the real model streams in.
 *
 * Deliberately ghosted rather than solid: at full opacity a blocky procedural stand-in reads as
 * *the product*, and the swap then looks like the page corrected a mistake. Semi-transparent, it
 * reads as scaffolding, and the real vehicle resolving into place reads as loading finishing.
 */
const PROXY_OPACITY = 0.28;

/** Duration of the placeholder-to-vehicle cross-fade. */
const PROXY_FADE_SECONDS = 0.45;

/**
 * Releases the placeholder's geometry and the materials cloned for it.
 *
 * Safe to call twice — the swap disposes on fade completion, and teardown disposes on unmount,
 * and which happens first depends on how quickly the user navigates away. `parent` is nulled by
 * `remove()`, so the second call detaches nothing and traverses an already-emptied subtree.
 */
function disposeProxy(proxy: THREE.Object3D): void {
  proxy.parent?.remove(proxy);
  proxy.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry?.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      material?.dispose();
    }
  });
  proxy.clear();
}

/**
 * Fades the placeholder out and disposes it.
 *
 * The real vehicle is already in the scene when this runs, so the two overlap for the fade rather
 * than the showroom flashing empty between them. `immediate` skips the animation for the case
 * where the "real" model is itself a procedural fallback — cross-fading a shape into an identical
 * copy of itself just looks like a flicker.
 */
function swapProxyForVehicle(proxy: THREE.Object3D, immediate: boolean): void {
  if (immediate) {
    disposeProxy(proxy);
    return;
  }

  const materials: THREE.Material[] = [];
  proxy.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material) materials.push(material);
    }
  });

  gsap.to(materials, {
    opacity: 0,
    duration: motionDuration(PROXY_FADE_SECONDS),
    ease: "power2.out",
    // Disposal is the completion handler rather than a separate timer so the geometry is released
    // exactly when it stops being drawn, however the tween ends.
    onComplete: () => disposeProxy(proxy),
  });
}

async function loadVehicleRoot(
  threeDConfig: Vehicle3DConfig,
  onProgress?: (fraction: number) => void,
): Promise<THREE.Object3D> {
  if (!threeDConfig.hasModel || !threeDConfig.modelUrl) return createProceduralVehicle();
  const gltf = await getGltfLoader().loadAsync(threeDConfig.modelUrl, (event) => {
    // `lengthComputable` is false whenever the response has no usable `Content-Length` — common
    // for a gzipped GLB. Reporting `loaded / 0` would emit Infinity, and guessing a denominator
    // would show a progress bar that lies; skipping the callback lets the UI fall back to an
    // indeterminate affordance instead.
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
