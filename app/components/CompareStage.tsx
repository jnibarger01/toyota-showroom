"use client";

/**
 * Side-by-side 3D comparison for the compare page: the chosen vehicles in adjacent columns, orbiting
 * together under one camera, each at true scale — so a Camry next to a Land Cruiser looks as much
 * smaller as it really is. The spec table below says "191.3 in vs. 192.1 in"; this shows it.
 *
 * Deliberately lighter than the builder's `VehicleCanvas`: a WebGL2 renderer only, one studio
 * environment, the `low`-tier LOD where a vehicle ships one (several vehicles load at once), no
 * picking, no configuration. It renders on demand — when the camera moves or a model lands — rather
 * than every frame, because a comparison mostly sits still while someone reads the table.
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Vehicle } from "../../lib/types/vehicle";
import { getGltfLoader, disposeSubtree } from "../../lib/three/assets";
import { resolveAssetUrl } from "../../lib/three/assetUrl";
import { trueScaleFactor } from "../../lib/three/arPlacement";
import { columnViewports, fitDistance } from "../../lib/three/compareLayout";
import { prepareVehicleRoot } from "./VehicleCanvas";
import { prefersReducedMotion } from "../../lib/three/motionPreference";

type Props = { vehicles: readonly Vehicle[] };

const FOV = 30;

export function CompareStage({ vehicles }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const withModels = vehicles.filter((vehicle) => vehicle.threeDConfig.hasModel && vehicle.threeDConfig.modelUrl);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || withModels.length === 0) return;
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setScissorTest(true);
    host.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 200);
    camera.position.set(7, 3.2, -8);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.9, 0);
    controls.enableDamping = !prefersReducedMotion();
    controls.enablePan = false;
    controls.maxPolarAngle = Math.PI * 0.49;

    const scenes = withModels.map(() => {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#0c1015");
      scene.environment = environment;
      const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#11151b", roughness: 0.9 }));
      scene.add(floor, new THREE.HemisphereLight("#ffffff", "#20242a", 0.6));
      return scene;
    });
    const radii: number[] = withModels.map(() => 0);

    let frameRequested = false;
    const requestFrame = () => {
      if (frameRequested || disposed) return;
      frameRequested = true;
      requestAnimationFrame(renderFrame);
    };
    const renderFrame = () => {
      frameRequested = false;
      if (disposed) return;
      const width = host.clientWidth;
      const height = host.clientHeight;
      const viewports = columnViewports(scenes.length, width, height);
      const columnAspect = (viewports[0]?.width ?? width) / Math.max(height, 1);
      camera.aspect = columnAspect;
      const largest = Math.max(...radii, 1);
      controls.minDistance = fitDistance(largest, FOV, columnAspect) * 0.6;
      controls.maxDistance = fitDistance(largest, FOV, columnAspect) * 2.2;
      camera.updateProjectionMatrix();
      // Damping needs a few more frames to settle after the pointer lets go.
      if (controls.update()) requestFrame();
      scenes.forEach((scene, index) => {
        const viewport = viewports[index]!;
        renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
        renderer.setScissor(viewport.x, viewport.y, viewport.width, viewport.height);
        renderer.render(scene, camera);
      });
    };

    const resize = () => {
      renderer.setSize(host.clientWidth, host.clientHeight);
      requestFrame();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    controls.addEventListener("change", requestFrame);

    withModels.forEach((vehicle, index) => {
      const config = vehicle.threeDConfig;
      const url = config.lodModelUrl ?? config.modelUrl!;
      getGltfLoader()
        .loadAsync(resolveAssetUrl(url))
        .then((gltf) => {
          if (disposed) {
            disposeSubtree(gltf.scene);
            return;
          }
          const root = gltf.scene;
          prepareVehicleRoot(root, config);
          root.updateWorldMatrix(true, true);
          const length = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).z;
          const catalogLength = vehicle.specs.find((spec) => spec.key === "length_in")?.value;
          const scale = trueScaleFactor(length, typeof catalogLength === "number" ? catalogLength : undefined);
          root.scale.multiplyScalar(scale);
          root.position.multiplyScalar(scale);
          root.updateWorldMatrix(true, true);
          radii[index] = new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere()).radius;
          scenes[index]!.add(root);
          // The first time the largest vehicle is known, frame it.
          const distance = fitDistance(Math.max(...radii), FOV, camera.aspect);
          camera.position.copy(controls.target).add(new THREE.Vector3(0.62, 0.3, -0.72).normalize().multiplyScalar(distance));
          setLoaded((count) => count + 1);
          requestFrame();
        })
        .catch(() => {
          if (!disposed) setFailed((names) => [...names, vehicle.model]);
        });
    });

    return () => {
      disposed = true;
      observer.disconnect();
      controls.dispose();
      // Floors, lights and every loaded vehicle; the shared environment map is released once below.
      for (const scene of scenes) disposeSubtree(scene);
      environment.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // Vehicles are identified by slug; a new selection is a new comparison.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withModels.map((vehicle) => vehicle.slug).join(",")]);

  if (withModels.length === 0) return null;

  return (
    <section className="compare-stage" aria-label="3D size comparison">
      <div
        ref={hostRef}
        className="compare-stage-canvas"
        role="img"
        aria-label={`3D view of ${withModels.map((vehicle) => `${vehicle.year} ${vehicle.model}`).join(", ")} side by side at true scale. Drag to orbit all of them together.`}
      />
      <div className="compare-stage-labels" aria-hidden="true">
        {withModels.map((vehicle) => (
          <span key={vehicle.slug}>
            {vehicle.year} {vehicle.model}
          </span>
        ))}
      </div>
      <p className="compare-stage-note" role="status">
        {loaded < withModels.length && failed.length === 0 ? `Loading ${withModels.length - loaded} model${withModels.length - loaded === 1 ? "" : "s"}…` : null}
        {failed.length > 0 ? `Could not load: ${failed.join(", ")}.` : null}
        {loaded === withModels.length ? "Shown at true relative scale. Drag to orbit together." : null}
      </p>
    </section>
  );
}
