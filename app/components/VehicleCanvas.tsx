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
};

export function VehicleCanvas({ threeDConfig, catalog, cameraPreset, lift, terrain, environmentPreset, onReady, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
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

  // Latest-value refs: the setup effect must run exactly once (loading a 39 MB GLB again on every
  // prop change is the thing this integration exists to avoid), so it reads callbacks through refs
  // rather than listing them as dependencies. The assignment happens in an effect, not inline during
  // render — writing to `ref.current` while rendering is an impure side effect React disallows (the
  // render function may run more than once before committing); an effect runs only after commit.
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const catalogRef = useRef(catalog);
  useEffect(() => {
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
    catalogRef.current = catalog;
  }, [catalog, onError, onReady]);

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

      const quality = resolveQuality(collectBrowserDeviceHints());
      const { renderer, mode } = await createRenderer(quality.antialias);
      if (cancelled) {
        renderer.dispose();
        return;
      }

      applyRendererQuality(renderer, quality);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.domElement.dataset.renderer = mode;
      renderer.domElement.dataset.quality = quality.tier;
      host.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
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

      // Start the render loop before the ~28 MiB GLB settles so the placeholder paints immediately.
      let running = true;
      let suspended = false;
      let contactShadow: THREE.Mesh | null = null;
      let controller: VehicleSceneController | null = null;
      const frameStats = new FrameTimeTracker(60);
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
          loop?.();
        }
      });
      suspended = idleGate.suspended;
      renderer.domElement.dataset.idle = suspended ? "1" : "0";

      loop = () => {
        if (!running) return;
        if (suspended) return;
        const stats = frameStats.record(performance.now());
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
        idleGate.dispose();
        resizeObserver.disconnect();
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
        controller = new VehicleSceneController(root, report.satisfied);
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
          detailed = await loadVehicleRoot(threeDConfig);
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
    gsap.to(root.position, { y: groundedYRef.current + lift * 0.045, duration: 0.35, ease: "power2.out" });
  }, [lift, sceneRevision]);

  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    gsap.to(camera.position, {
      x: cameraPreset.position[0],
      y: cameraPreset.position[1],
      z: cameraPreset.position[2],
      duration: 0.85,
      ease: "power3.inOut",
    });
    gsap.to(controls.target, {
      x: cameraPreset.target[0],
      y: cameraPreset.target[1],
      z: cameraPreset.target[2],
      duration: 0.85,
      ease: "power3.inOut",
    });
  }, [cameraPreset]);

  useEffect(() => {
    if (environmentRef.current) applyEnvironment(environmentRef.current, terrain, environmentPreset);
  }, [terrain, environmentPreset]);

  return <div ref={hostRef} className="vehicle-canvas" />;
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

async function loadVehicleRoot(threeDConfig: Vehicle3DConfig): Promise<THREE.Object3D> {
  if (!threeDConfig.hasModel || !threeDConfig.modelUrl) return createProceduralVehicle();
  const gltf = await getGltfLoader().loadAsync(threeDConfig.modelUrl);
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
