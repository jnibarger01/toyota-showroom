"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import * as THREE from "three";
import * as THREE_WEBGPU from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

export type BuildState = {
  paint: string;
  lift: number;
  roofRack: boolean;
  lightBar: boolean;
  sliders: boolean;
  wheels: string;
};

export type CameraPreset = {
  id: string;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
};

type Props = {
  build: BuildState;
  cameraPreset: CameraPreset;
};

type SceneRefs = {
  root: THREE.Group;
  paintMaterials: THREE.MeshPhysicalMaterial[];
  roofRack: THREE.Group;
  lightBar: THREE.Group;
  sliders: THREE.Group;
  wheels: THREE.Group[];
  wheelMounts: THREE.Object3D[];
};

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

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function VehicleCanvas({ build, cameraPreset }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const refs = useRef<SceneRefs | null>(null);

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

      scene.add(new THREE.HemisphereLight("#edf5ff", "#18100b", 2.5));

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
        new THREE.MeshPhysicalMaterial({
          color: "#080a0d",
          roughness: 0.36,
          metalness: 0.12,
          clearcoat: 0.35,
        }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);

      const grid = new THREE.GridHelper(36, 36, "#26303a", "#151a20");
      grid.position.y = 0.002;
      scene.add(grid);

      const model = await loadVehicleModel();
      if (cancelled) return;
      scene.add(model.root);
      refs.current = model;
      applyBuild(model, build, false);

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
        scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        });
      };
    })().catch((error) => {
      console.error("Vehicle scene initialization failed:", error);
      const host = hostRef.current;
      if (host) host.dataset.sceneError = String(error);
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (refs.current) applyBuild(refs.current, build, true);
  }, [build]);

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

  return <div ref={hostRef} className="vehicle-canvas" />;
}

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

async function loadVehicleModel(): Promise<SceneRefs> {
  const draco = new DRACOLoader();
  draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
  draco.setDecoderConfig({ type: "wasm" });

  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);

  try {
    const gltf = await loader.loadAsync(`${basePath}/models/modsnation_7416_assets_assembled.glb`);
    const root = gltf.scene;
    root.name = "ModsNation 7416 assembled 4Runner";

    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    root.position.sub(center);
    root.position.y += size.y / 2;
    root.rotation.y = Math.PI;

    const paintMaterials: THREE.MeshPhysicalMaterial[] = [];
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;

      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material.name === "body.carmain" && material instanceof THREE.MeshPhysicalMaterial) {
          paintMaterials.push(material);
        }
      }
    });

    const wheelMountNames = [
      "MOUNT_WHEEL_FRONT_LEFT",
      "MOUNT_WHEEL_FRONT_RIGHT",
      "MOUNT_WHEEL_REAR_LEFT",
      "MOUNT_WHEEL_REAR_RIGHT",
    ];
    const wheelMounts = wheelMountNames
      .map((name) => root.getObjectByName(name))
      .filter((mount): mount is THREE.Object3D => Boolean(mount));

    const accessories = createAccessories(root, []);
    draco.dispose();

    return {
      root,
      paintMaterials,
      wheelMounts,
      ...accessories,
    };
  } catch (error) {
    draco.dispose();
    console.error("High-detail glTF failed to load; using procedural fallback.", error);
    return createProceduralFallback();
  }
}

function createAccessories(root: THREE.Group, wheelMounts: THREE.Object3D[]) {
  const black = new THREE.MeshPhysicalMaterial({ color: "#080a0c", roughness: 0.34, metalness: 0.55 });
  const amber = new THREE.MeshStandardMaterial({ color: "#ffb000", emissive: "#ff8a00", emissiveIntensity: 5 });
  const rubber = new THREE.MeshStandardMaterial({ color: "#111214", roughness: 0.92 });
  const alloy = new THREE.MeshStandardMaterial({ color: "#656b74", metalness: 0.82, roughness: 0.24 });

  const roofRack = new THREE.Group();
  roofRack.name = "ADDON_ROOF_RACK";
  roofRack.position.set(0, 1.86, -0.15);
  const rackBase = roundedBox(1.55, 0.06, 2.5, 0.025, black);
  roofRack.add(rackBase);
  for (let i = -4; i <= 4; i++) {
    const bar = roundedBox(1.66, 0.07, 0.06, 0.02, black);
    bar.position.z = i * 0.27;
    roofRack.add(bar);
  }
  root.add(roofRack);

  const lightBar = new THREE.Group();
  lightBar.name = "ADDON_LIGHT_BAR";
  lightBar.position.set(0, 2.0, 0.75);
  lightBar.add(roundedBox(1.5, 0.1, 0.12, 0.025, black));
  for (let i = -7; i <= 7; i++) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8), amber);
    lamp.position.set(i * 0.095, 0, 0.07);
    lightBar.add(lamp);
  }
  root.add(lightBar);

  const sliders = new THREE.Group();
  sliders.name = "ADDON_SLIDERS";
  for (const x of [-1.08, 1.08]) {
    const slider = roundedBox(0.1, 0.1, 2.85, 0.025, black);
    slider.position.set(x, 0.42, -0.05);
    sliders.add(slider);
  }
  root.add(sliders);

  const wheels: THREE.Group[] = [];
  for (const mount of wheelMounts) {
    const wheel = createWheel(rubber, alloy);
    wheel.name = `ADDON_${mount.name}`;
    mount.add(wheel);
    wheels.push(wheel);
  }

  return { roofRack, lightBar, sliders, wheels };
}

function applyBuild(refs: SceneRefs, build: BuildState, animate: boolean) {
  const target = new THREE.Color(build.paint);
  refs.paintMaterials.forEach((material) => {
    if (animate) {
      gsap.to(material.color, {
        r: target.r,
        g: target.g,
        b: target.b,
        duration: 0.45,
        ease: "power2.out",
      });
    } else {
      material.color.copy(target);
    }
  });

  const setVisibleScale = (object: THREE.Object3D, visible: boolean) => {
    if (animate) gsap.to(object.scale, { x: 1, y: visible ? 1 : 0.001, z: 1, duration: 0.3 });
    else object.scale.set(1, visible ? 1 : 0.001, 1);
  };

  setVisibleScale(refs.roofRack, build.roofRack);
  setVisibleScale(refs.lightBar, build.lightBar);
  setVisibleScale(refs.sliders, build.sliders);

  const lift = build.lift * 0.045;
  refs.root.position.y = lift;
  const wheelScale = build.wheels === "Stock" ? 0.9 : build.wheels === "Beadlock" ? 1.08 : 1;
  refs.wheels.forEach((wheel) => {
    if (animate) gsap.to(wheel.scale, { x: wheelScale, y: wheelScale, z: wheelScale, duration: 0.35 });
    else wheel.scale.setScalar(wheelScale);
  });
}

function createProceduralFallback(): SceneRefs {
  const root = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({
    color: "#1558d6",
    metalness: 0.72,
    roughness: 0.24,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  const black = new THREE.MeshPhysicalMaterial({ color: "#080a0c", roughness: 0.34, metalness: 0.55 });
  const body = roundedBox(2.2, 1.1, 4.9, 0.18, paint);
  body.position.y = 1.05;
  root.add(body);
  const roofRack = new THREE.Group();
  roofRack.add(roundedBox(1.7, 0.08, 2.8, 0.025, black));
  roofRack.position.y = 1.75;
  root.add(roofRack);
  const lightBar = new THREE.Group();
  lightBar.add(roundedBox(1.5, 0.1, 0.12, 0.025, black));
  lightBar.position.set(0, 1.9, 1.1);
  root.add(lightBar);
  const sliders = new THREE.Group();
  root.add(sliders);
  return { root, paintMaterials: [paint], roofRack, lightBar, sliders, wheels: [], wheelMounts: [] };
}

function roundedBox(width: number, height: number, depth: number, radius: number, material: THREE.Material) {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: radius * 0.55,
    bevelThickness: radius * 0.55,
  });
  geometry.center();
  return new THREE.Mesh(geometry, material);
}

function createWheel(rubber: THREE.Material, alloy: THREE.Material) {
  const wheel = new THREE.Group();
  wheel.rotation.y = Math.PI / 2;
  const tire = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.15, 20, 48), rubber);
  wheel.add(tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.16, 24), alloy);
  rim.rotation.x = Math.PI / 2;
  wheel.add(rim);
  return wheel;
}
