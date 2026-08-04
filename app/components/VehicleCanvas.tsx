"use client";

import { useEffect, useRef } from "react";
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

export type CameraPreset = {
  id: string;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
};

export type Terrain = "Studio" | "Trail" | "Night";
export type SceneMood = "Day" | "Golden hour" | "Night";

type Props = {
  threeDConfig: Vehicle3DConfig;
  /** Full server catalog. Only the options this GLB can satisfy are handed back via `onReady`. */
  catalog: CustomizationOption[];
  cameraPreset: CameraPreset;
  /** Ride-height offset in inches; not a catalog category, so it stays a plain prop. */
  lift: number;
  terrain: Terrain;
  sceneMood: SceneMood;
  /**
   * Fired once the model is loaded, cleaned up, and verified. The controller is the caller's
   * handle for every subsequent scene mutation — the canvas itself never applies an option.
   */
  onReady: (controller: VehicleSceneController, applicable: CustomizationOption[]) => void;
  onError: (message: string) => void;
};

export function VehicleCanvas({ threeDConfig, catalog, cameraPreset, lift, terrain, sceneMood, onReady, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rootRef = useRef<THREE.Object3D | null>(null);
  const environmentRef = useRef<EnvironmentRefs | null>(null);

  // Latest-value refs: the setup effect must run exactly once (loading a 57 MB GLB again on every
  // prop change is the thing this integration exists to avoid), so it reads callbacks through refs
  // rather than listing them as dependencies.
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const catalogRef = useRef(catalog);
  onReadyRef.current = onReady;
  onErrorRef.current = onError;
  catalogRef.current = catalog;

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

      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.domElement.dataset.renderer = mode;
      host.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.minDistance = 4;
      controls.maxDistance = 15;
      controls.maxPolarAngle = Math.PI * 0.49;
      controls.target.set(...cameraPreset.target);
      controlsRef.current = controls;

      const hemi = new THREE.HemisphereLight("#edf5ff", "#18100b", 2.5);
      scene.add(hemi);

      const key = new THREE.DirectionalLight("#ffffff", 4.5);
      key.position.set(6, 9, 7);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      scene.add(key);

      const rim = new THREE.DirectionalLight("#4169ff", 2.7);
      rim.position.set(-7, 4, -6);
      scene.add(rim);

      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(50, 50),
        new THREE.MeshPhysicalMaterial({ color: "#080a0d", roughness: 0.36, metalness: 0.12, clearcoat: 0.35 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);

      const grid = new THREE.GridHelper(36, 36, "#26303a", "#151a20");
      grid.position.y = 0.002;
      scene.add(grid);
      const environment = { scene, floor, grid, hemi, key, rim };
      environmentRef.current = environment;
      applyEnvironment(environment, terrain, sceneMood);

      let root: THREE.Object3D;
      try {
        root = await loadVehicleRoot(threeDConfig);
      } catch (error) {
        console.error("High-detail glTF failed to load; using procedural fallback.", error);
        onErrorRef.current("The detailed model could not be loaded. Showing a simplified vehicle.");
        root = createProceduralVehicle();
      }
      if (cancelled) {
        disposeSubtree(root);
        return;
      }

      try {
        await installWheelAndTireAssets(root, threeDConfig);
      } catch (error) {
        // Replacement running gear is additive enhancement; retain the complete base model if an
        // optional glTF cannot be fetched or decoded.
        console.warn("[customization] supplied wheel and tyre glTFs could not be loaded.", error);
      }
      prepareVehicleRoot(root, threeDConfig);
      buildProceduralAccessories(root);
      scene.add(root);
      rootRef.current = root;

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

      const resize = () => {
        const width = Math.max(host.clientWidth, 1);
        const height = Math.max(host.clientHeight, 1);
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(host);

      let running = true;
      const loop = async () => {
        if (!running) return;
        controls.update();
        if (renderer.renderAsync) await renderer.renderAsync(scene, camera);
        else renderer.render(scene, camera);
        requestAnimationFrame(loop);
      };
      void loop();

      cleanup = () => {
        running = false;
        observer.disconnect();
        controls.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        // The controller owns every material clone and attachment it made; disposing it releases
        // those before the base scene's own geometry is released below.
        controller.dispose();
        floor.geometry.dispose();
        (floor.material as THREE.Material).dispose();
        grid.dispose();
        rootRef.current = null;
      };
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
    if (root) gsap.to(root.position, { y: lift * 0.045, duration: 0.35, ease: "power2.out" });
  }, [lift]);

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
    if (environmentRef.current) applyEnvironment(environmentRef.current, terrain, sceneMood);
  }, [terrain, sceneMood]);

  return <div ref={hostRef} className="vehicle-canvas" />;
}

type EnvironmentRefs = {
  scene: THREE.Scene;
  floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
  grid: THREE.GridHelper;
  hemi: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
};

function applyEnvironment(environment: EnvironmentRefs, terrain: Terrain, sceneMood: SceneMood): void {
  const mood = terrain === "Night" || sceneMood === "Night" ? "Night" : sceneMood;
  const palette = mood === "Night"
    ? { bg: "#050813", floor: "#070a13", sky: "#33436c", ground: "#080a12", key: 1.2, rim: 3.5 }
    : mood === "Golden hour"
      ? { bg: "#21140f", floor: "#17100d", sky: "#ffd3a1", ground: "#5e3023", key: 3.4, rim: 2.2 }
      : { bg: terrain === "Trail" ? "#152017" : "#0b0f14", floor: terrain === "Trail" ? "#17150e" : "#080a0d", sky: "#edf5ff", ground: "#18100b", key: 4.5, rim: 2.7 };
  environment.scene.background = new THREE.Color(palette.bg);
  environment.scene.fog = new THREE.Fog(palette.bg, terrain === "Trail" ? 10 : 16, terrain === "Trail" ? 25 : 32);
  environment.floor.material.color.set(palette.floor);
  environment.hemi.color.set(palette.sky);
  environment.hemi.groundColor.set(palette.ground);
  environment.key.intensity = palette.key;
  environment.rim.intensity = palette.rim;
  environment.grid.visible = terrain === "Studio";
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
    assembly.scale.setScalar(config.scale ?? 1);

    const tire = instantiateAsset(tireSource);
    tire.name = tireNodeName;
    const wheel = instantiateAsset(wheelSource);
    wheel.name = wheelNodeName;
    renameMaterials(wheel, index < 2 ? "wheel.metal" : "wheel.metal.001");

    assembly.add(tire, wheel);
    attachToMount(mounts[index]!, assembly, "authored-wheel-and-tire");
  }
}

function removeNode(node: THREE.Object3D | undefined): void {
  node?.parent?.remove(node);
}

function renameMaterials(root: THREE.Object3D, name: string): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      material.name = name === "wheel.metal.001" && material.name === "wheel.metal" ? name : material.name;
    }
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
