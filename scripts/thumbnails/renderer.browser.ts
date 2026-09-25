/**
 * Browser half of `scripts/render-thumbnails.ts`. Bundled by esbuild and loaded into headless
 * Chromium; exposes `window.renderVehicleThumbnail(job)` which returns a PNG data URL.
 *
 * Grounding, orientation and running gear deliberately mirror `installWheelAndTireAssets` and
 * `prepareVehicleRoot` in `app/components/VehicleCanvas.tsx` (authored wheels, scale, the extra π
 * yaw, hidden nodes, grounding nodes), so the thumbnail shows the car the builder shows.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export interface ThumbnailJob {
  slug: string;
  modelUrl: string;
  scale?: [number, number, number];
  rotation?: [number, number, number];
  hiddenNodeNames?: string[];
  groundingNodeNames?: string[];
  texturePolicy?: "preserve" | "factors-only";
  /**
   * The catalog's "front" camera preset. Only its horizontal direction is used, as the axis the
   * nose faces; the thumbnail swings off it by {@link THREE_QUARTER_YAW} and re-fits distance.
   * (Hero presets are not used: several of them frame the rear three-quarter.)
   */
  frontPosition: [number, number, number];
  frontTarget: [number, number, number];
  wheelAndTireAssets?: {
    wheelUrl: string;
    tireUrl: string;
    scale?: number;
    wheelNodeNames: string[];
    tireNodeNames: string[];
  };
  wheelMountNames: string[];
  /** Catalog material options applied before rendering, e.g. a factory wheel finish. */
  materialOverrides?: Array<{ materials: string[]; color?: string; metalness?: number; roughness?: number }>;
  width: number;
  height: number;
}

/** Front three-quarter: swing ~38° off the nose axis. */
const THREE_QUARTER_YAW = THREE.MathUtils.degToRad(-38);
const LOOK_DOWN = THREE.MathUtils.degToRad(16);

const TEXTURE_SLOTS = [
  "map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap",
  "bumpMap", "displacementMap", "clearcoatMap", "clearcoatNormalMap", "clearcoatRoughnessMap",
  "sheenColorMap", "sheenRoughnessMap", "specularIntensityMap", "specularColorMap",
];

function visibleMeshBounds(root: THREE.Object3D, nodeNames?: string[]): THREE.Box3 {
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  const roots = nodeNames?.length
    ? nodeNames.map((name) => root.getObjectByName(name)).filter((node): node is THREE.Object3D => Boolean(node))
    : [root];
  for (const start of roots) {
    start.traverseVisible((object) => {
      if (object instanceof THREE.Mesh) box.expandByObject(object);
    });
  }
  return box;
}

const loader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath("/draco/"));

async function loadRoot(job: ThumbnailJob): Promise<THREE.Object3D> {
  const root = (await loader.loadAsync(job.modelUrl)).scene;
  const assets = job.wheelAndTireAssets;
  if (!assets) return root;

  const mounts = job.wheelMountNames.map((name) => root.getObjectByName(name));
  if (mounts.some((mount) => !mount)) return root;
  const [wheel, tire] = await Promise.all([loader.loadAsync(assets.wheelUrl), loader.loadAsync(assets.tireUrl)]);
  mounts.forEach((mount, index) => {
    for (const name of [assets.wheelNodeNames[index], assets.tireNodeNames[index]]) {
      const baked = name ? root.getObjectByName(name) : undefined;
      baked?.parent?.remove(baked);
    }
    const assembly = new THREE.Group();
    const tireCopy = tire.scene.clone();
    tireCopy.name = assets.tireNodeNames[index] ?? "";
    const wheelCopy = wheel.scene.clone();
    wheelCopy.name = assets.wheelNodeNames[index] ?? "";
    assembly.add(tireCopy, wheelCopy);
    assembly.scale.setScalar(assets.scale ?? 1);
    mount!.add(assembly);
  });
  return root;
}

function prepare(root: THREE.Object3D, job: ThumbnailJob): void {
  if (job.scale) root.scale.set(...job.scale);
  root.rotation.set(job.rotation?.[0] ?? 0, Math.PI + (job.rotation?.[1] ?? 0), job.rotation?.[2] ?? 0);
  for (const name of job.hiddenNodeNames ?? []) {
    const node = root.getObjectByName(name);
    if (node) node.visible = false;
  }
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    if (job.texturePolicy !== "factors-only") return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const slots = material as unknown as Record<string, unknown>;
      for (const slot of TEXTURE_SLOTS) if (slot in slots) slots[slot] = null;
      material.needsUpdate = true;
    }
  });
  for (const override of job.materialOverrides ?? []) {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!override.materials.includes(material.name) || !(material instanceof THREE.MeshStandardMaterial)) continue;
        if (override.color) material.color.set(override.color);
        if (override.metalness !== undefined) material.metalness = override.metalness;
        if (override.roughness !== undefined) material.roughness = override.roughness;
      }
    });
  }
  const ground = visibleMeshBounds(root, job.groundingNodeNames);
  if (!ground.isEmpty()) {
    const center = ground.getCenter(new THREE.Vector3());
    root.position.sub(center);
    root.position.y += ground.getSize(new THREE.Vector3()).y / 2;
  }
}

/**
 * Places the camera along the hero direction and solves for the distance and pan at which the
 * projected bounding box fills a fixed fraction of the frame, centred. Fitting on the eight box
 * corners (not a bounding sphere) keeps long sedans and tall SUVs at the same visual weight.
 */
function frame(camera: THREE.PerspectiveCamera, box: THREE.Box3, job: ThumbnailJob): void {
  const front = new THREE.Vector3(...job.frontPosition).sub(new THREE.Vector3(...job.frontTarget)).setY(0).normalize();
  const horizontal = front.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE_QUARTER_YAW);
  // Same look-down for every vehicle so the grid reads as one set.
  const direction = horizontal.multiplyScalar(Math.cos(LOOK_DOWN)).setY(Math.sin(LOOK_DOWN));

  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
    (i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z),
  );
  const target = box.getCenter(new THREE.Vector3());
  const fillX = 0.84;
  const fillY = 0.72;

  const project = (distance: number) => {
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const ndc = new THREE.Box2();
    for (const corner of corners) {
      const p = corner.clone().project(camera);
      ndc.expandByPoint(new THREE.Vector2(p.x, p.y));
    }
    return ndc;
  };

  for (let pass = 0; pass < 3; pass += 1) {
    let lo = 0.5;
    let hi = 200;
    for (let i = 0; i < 40; i += 1) {
      const mid = (lo + hi) / 2;
      const ndc = project(mid);
      const fits = ndc.max.x - ndc.min.x <= 2 * fillX && ndc.max.y - ndc.min.y <= 2 * fillY;
      if (fits) hi = mid;
      else lo = mid;
    }
    const ndc = project(hi);
    // Pan so the projected box is centred (slightly low, leaving headroom above the roof).
    const offset = ndc.getCenter(new THREE.Vector2()).sub(new THREE.Vector2(0, -0.04));
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const distance = camera.position.distanceTo(target);
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * distance;
    target.addScaledVector(right, offset.x * halfHeight * camera.aspect).addScaledVector(up, offset.y * halfHeight);
  }
}

async function renderVehicleThumbnail(job: ThumbnailJob): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = job.width;
  canvas.height = job.height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(job.width, job.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.9;

  const root = await loadRoot(job);
  prepare(root, job);
  scene.add(root);
  const box = visibleMeshBounds(root);
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z);

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(span * 0.6, span * 1.6, span * 0.9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -span;
  key.shadow.camera.right = span;
  key.shadow.camera.top = span;
  key.shadow.camera.bottom = -span;
  key.shadow.camera.far = span * 5;
  key.shadow.radius = 6;
  key.shadow.bias = -0.0005;
  scene.add(key);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(span * 6, span * 6), new THREE.ShadowMaterial({ opacity: 0.45 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = box.min.y + 0.001;
  floor.receiveShadow = true;
  scene.add(floor);

  const camera = new THREE.PerspectiveCamera(30, job.width / job.height, 0.05, 500);
  frame(camera, box, job);

  renderer.render(scene, camera);
  const url = canvas.toDataURL("image/png");
  renderer.dispose();
  pmrem.dispose();
  return url;
}

(window as unknown as { renderVehicleThumbnail: typeof renderVehicleThumbnail }).renderVehicleThumbnail =
  renderVehicleThumbnail;
