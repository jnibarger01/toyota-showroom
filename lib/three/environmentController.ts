import * as THREE from "three";
import { applyHdriPreset, type HdriEnvironmentHandle, type HdriLightRefs } from "./hdriEnvironment";
import { recordMetric } from "../observability/clientMetrics";

/**
 * Owns the runtime environment/lighting-rig authority `VehicleCanvas.tsx` used to keep as inline
 * object construction plus a free `applyEnvironment` function and two scattered effects: the
 * hemisphere/key/rim/fill lights, the floor and grid, the Night-preset starfield and Trail-preset
 * rocks, terrain/environment-preset palette application, quality-driven shadow/light adjustment,
 * and the HDRI preset lifecycle (`lib/three/hdriEnvironment.ts`, already a clean standalone module
 * from Mission 1 — this wraps it, not replaces it). Mission Priority 5.
 *
 * Deliberately plain TypeScript, the same shape `CameraController` (`lib/three/
 * cameraController.ts`, Priority 3) and `VehicleSceneController` already use: no React import, no
 * application-state or agent-layer dependency, a constructor that builds and owns everything it
 * creates, and a single `dispose()` that undoes it.
 *
 * ## Application preference vs. runtime scene authority
 *
 * `terrain`/`environmentPreset`/`hdriPresetId` are still `BuilderApp`/`VehicleCanvas` React props —
 * *which* preset the user picked is an application/configurator preference, not scene state, and
 * stays there (`docs/AGENT_API.md`'s "What is deliberately not implemented yet" section draws the
 * same line for the agent-API side of this same question). What moves here is the *runtime
 * authority that applies a chosen preset to real THREE.js objects* — the palette math, the light/
 * material mutations, the HDRI load-and-swap lifecycle. `VehicleCanvas.tsx` calls `setTerrain`/
 * `setPreset`/`applyHdri` when its props change; it no longer owns what those calls actually do to
 * the scene graph.
 *
 * ## What this class does NOT do, on purpose
 *
 * No renderer/render loop (`RendererLike`, `renderer.shadowMap.enabled`, pixel ratio — stay in
 * `VehicleCanvas.tsx` until Priority 6). No contact shadow (`createContactShadow` in
 * `VehicleCanvas.tsx`): it is sized to the *loaded vehicle's* footprint, a per-vehicle rendering
 * effect tied to `sceneRevision`, not terrain/HDRI/lighting-preset authority. No new HDR assets,
 * no KTX2, no postprocessing — this preserves exactly what `applyHdriPreset`/`applyEnvironment`
 * already did, moved to a typed owner, not extended.
 */

export type Terrain = "Studio" | "Trail" | "Night";
export type EnvironmentPreset = "Daytime" | "Sunset" | "Night";

/** The subset of `QualitySettings` (`lib/three/quality.ts`) that affects environment-owned objects
 * — shadow casting on the key light and the floor, and the two secondary lights' intensity scale.
 * Kept as its own narrow type rather than importing the full `QualitySettings` so this module does
 * not need to know about pixel ratio, antialiasing, or anything else a renderer-level concern owns. */
export interface EnvironmentQualityInputs {
  shadowsEnabled: boolean;
  shadowMapSize: number;
  secondaryLightScale: number;
  /**
   * Points drawn in the Night-preset starfield. Optional so existing callers that only care about
   * shadows keep compiling; `applyQuality` leaves the current count alone when it is absent.
   */
  starfieldCount?: number;
}

export interface EnvironmentControllerOptions {
  scene: THREE.Scene;
  quality: EnvironmentQualityInputs;
  initialTerrain: Terrain;
  initialPreset: EnvironmentPreset;
  /** Points shown only for the Night preset. Matches `quality.starfieldCount` at the call site. */
  starfieldCount?: number;
}

/**
 * Labels the backend for telemetry only. Unlike `hdriEnvironment`'s narrowing guard this is a
 * duck-type: a test double declaring `isWebGLRenderer: true` should be *reported* as webgl, and
 * nothing here touches GL state, so there is no reason to demand a real instance.
 */
function isWebGLRendererLike(renderer: THREE.WebGLRenderer | { isWebGLRenderer?: boolean }): boolean {
  return (
    renderer instanceof THREE.WebGLRenderer ||
    (renderer as { isWebGLRenderer?: boolean }).isWebGLRenderer === true
  );
}

export class EnvironmentController {
  private readonly scene: THREE.Scene;
  readonly floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
  readonly grid: THREE.GridHelper;
  readonly hemi: THREE.HemisphereLight;
  readonly key: THREE.DirectionalLight;
  readonly rim: THREE.DirectionalLight;
  readonly fill: THREE.DirectionalLight;
  readonly stars: THREE.Points;
  readonly rocks: THREE.Group;

  private terrain: Terrain;
  private preset: EnvironmentPreset;
  private hdriHandle: HdriEnvironmentHandle | null = null;
  /** Bumped on every `applyHdri` call so a slower, superseded request's late-arriving result is
   * discarded instead of clobbering a newer one that already committed — see that method's own
   * doc comment for the race this guards. */
  private hdriGeneration = 0;
  private disposed = false;

  constructor(options: EnvironmentControllerOptions) {
    this.scene = options.scene;
    this.terrain = options.initialTerrain;
    this.preset = options.initialPreset;

    this.hemi = new THREE.HemisphereLight("#edf5ff", "#18100b", 1.8);
    this.scene.add(this.hemi);

    // `bias`/`normalBias` avoid shadow acne without pulling the shadow away from the geometry that
    // casts it ("peter-panning") — too small and the floor self-shadows in moire bands, too large
    // and the vehicle's own contact shadow detaches from its tires. The explicit frustum is sized
    // to the largest catalog vehicle (the AE86, ~9m long) rather than three's default ±5 box, which
    // clipped shadow coverage for anything longer than a compact car.
    this.key = new THREE.DirectionalLight("#ffffff", 4.2);
    this.key.position.set(6, 9, 7);
    this.key.castShadow = options.quality.shadowsEnabled;
    this.key.shadow.mapSize.set(options.quality.shadowMapSize, options.quality.shadowMapSize);
    this.key.shadow.bias = -0.00018;
    this.key.shadow.normalBias = 0.025;
    this.key.shadow.camera.near = 1;
    this.key.shadow.camera.far = 30;
    this.key.shadow.camera.left = -11;
    this.key.shadow.camera.right = 11;
    this.key.shadow.camera.top = 11;
    this.key.shadow.camera.bottom = -11;
    this.key.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.key);

    // Raised and dimmed relative to the original rig: at the old (-7, 4, -6) grazing angle this
    // blue rim light hit the glossy floor almost edge-on and blew out into a large unshadowed
    // specular hotspot that read as a glow the vehicle was floating in, drowning out the contact
    // shadow underneath it. Steepening the angle and tempering the floor material below (both parts
    // of the same fix) let the actual shadow read again.
    this.rim = new THREE.DirectionalLight("#4169ff", 1.6 * options.quality.secondaryLightScale);
    this.rim.position.set(-6, 7.5, -6);
    this.scene.add(this.rim);

    // Fills the shaded (camera-facing, key-light-averted) side so the vehicle doesn't render as a
    // near-silhouette. No shadow: this is a soft bounce-light stand-in, not a directional key.
    this.fill = new THREE.DirectionalLight("#dce8ff", 1.1 * options.quality.secondaryLightScale);
    this.fill.position.set(-2, 3, 9);
    this.scene.add(this.fill);

    // Lower clearcoat/higher roughness than a mirror-glossy floor: the rim light's specular
    // reflection alone could otherwise out-shine the actual contact shadow beneath the vehicle.
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 50),
      new THREE.MeshPhysicalMaterial({ color: "#0a0c10", roughness: 0.6, metalness: 0.05, clearcoat: 0.12, clearcoatRoughness: 0.4 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = options.quality.shadowsEnabled;
    this.scene.add(this.floor);

    this.grid = new THREE.GridHelper(36, 36, "#26303a", "#151a20");
    this.grid.position.y = 0.002;
    this.scene.add(this.grid);

    // Allocated once at the ceiling and narrowed with `setDrawRange` rather than rebuilt per tier.
    // Rebuilding would re-randomise every star position, so a mid-session downgrade would visibly
    // shuffle the sky instead of quietly thinning it — and would allocate on the exact frames the
    // governor already believes are too slow.
    this.stars = createStarfield();
    setStarfieldCount(this.stars, options.starfieldCount ?? options.quality.starfieldCount ?? MAX_STARFIELD_COUNT);
    this.stars.visible = false;
    this.scene.add(this.stars);

    this.rocks = createTrailRocks();
    this.rocks.visible = false;
    this.scene.add(this.rocks);

    this.applyPalette();
  }

  get currentTerrain(): Terrain {
    return this.terrain;
  }

  get currentPreset(): EnvironmentPreset {
    return this.preset;
  }

  setTerrain(terrain: Terrain): void {
    this.terrain = terrain;
    this.applyPalette();
  }

  setPreset(preset: EnvironmentPreset): void {
    this.preset = preset;
    this.applyPalette();
  }

  /** Re-applies both in one pass — the shape `VehicleCanvas.tsx`'s combined terrain+preset effect
   * needs, so a vehicle switch or deep-link restore doesn't run the palette math twice. */
  setTerrainAndPreset(terrain: Terrain, preset: EnvironmentPreset): void {
    this.terrain = terrain;
    this.preset = preset;
    this.applyPalette();
  }

  private applyPalette(): void {
    const palette =
      this.preset === "Night"
        ? { bg: "#050813", floor: "#0b0d15", sky: "#33436c", ground: "#080a12", keyColor: "#b8c9ff", rimColor: "#4169ff", fillColor: "#26314f", key: 1.0, rim: 1.7, fill: 0.5, hemi: 1.1 }
        : this.preset === "Sunset"
          ? { bg: "#21140f", floor: "#1c130f", sky: "#ffd3a1", ground: "#5e3023", keyColor: "#ffb36b", rimColor: "#ff5a36", fillColor: "#ffdcb0", key: 2.6, rim: 1.4, fill: 0.9, hemi: 1.6 }
          : { bg: this.terrain === "Trail" ? "#152017" : "#0b0f14", floor: this.terrain === "Trail" ? "#191712" : "#0a0c10", sky: "#edf5ff", ground: "#18100b", keyColor: "#ffffff", rimColor: "#4169ff", fillColor: "#dce8ff", key: 4.2, rim: 1.6, fill: 1.1, hemi: 1.8 };
    this.scene.background = new THREE.Color(palette.bg);
    this.scene.fog = new THREE.Fog(palette.bg, this.terrain === "Trail" ? 10 : 16, this.terrain === "Trail" ? 25 : 32);
    this.floor.material.color.set(palette.floor);
    this.hemi.color.set(palette.sky);
    this.hemi.groundColor.set(palette.ground);
    this.hemi.intensity = palette.hemi;
    this.key.color.set(palette.keyColor);
    this.key.intensity = palette.key;
    this.rim.color.set(palette.rimColor);
    this.rim.intensity = palette.rim;
    this.fill.color.set(palette.fillColor);
    this.fill.intensity = palette.fill;
    this.grid.visible = this.terrain === "Studio";
    // Both are static set dressing, not physically part of any vehicle, so they're built once at
    // construction and simply shown or hidden here rather than rebuilt per preset switch.
    this.stars.visible = this.preset === "Night";
    this.rocks.visible = this.terrain === "Trail";
  }

  /** Re-applies quality-governed shadow/light settings — the environment-owned half of
   * `VehicleCanvas.tsx`'s `applyTier`, called on every `QualityGovernor` tier change. */
  applyQuality(quality: EnvironmentQualityInputs): void {
    this.key.castShadow = quality.shadowsEnabled;
    if (quality.shadowsEnabled) {
      this.key.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      // three caches the shadow render target and will not reallocate it just because mapSize
      // changed, so without this the new resolution is stored and never takes effect — the
      // expensive half of a downgrade would silently do nothing.
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
    this.floor.receiveShadow = quality.shadowsEnabled;
    this.rim.intensity = 1.6 * quality.secondaryLightScale;
    this.fill.intensity = 1.1 * quality.secondaryLightScale;
    // Before this, `starfieldCount` was read once at construction, so the governor could drop to
    // `low` and still draw all 400 points — one of the tier knobs that looked live in the table and
    // was inert in practice.
    if (quality.starfieldCount !== undefined) setStarfieldCount(this.stars, quality.starfieldCount);
  }

  /**
   * Applies a catalog HDRI preset id (or clears it when `undefined`) — thin wrapper over
   * `applyHdriPreset`, owning the dispose-handle lifecycle across calls (Mission Priority 1's
   * `hdriEnvironment.ts` already does the load/PMREM/dispose work standalone; this is not a
   * reimplementation) plus supersession: calling this again before a prior call's texture load has
   * resolved discards the earlier call's result instead of letting whichever `fetch` happens to
   * finish last win — a real race the pre-Priority-5 `VehicleCanvas.tsx` effect guarded with its
   * own `cancelled` flag, which every caller of a shared controller needs, not only a React effect.
   */
  async applyHdri(
    renderer: THREE.WebGLRenderer | { isWebGLRenderer?: boolean },
    hdriPresetId: string | undefined,
  ): Promise<void> {
    const generation = (this.hdriGeneration += 1);
    const refs: HdriLightRefs = { scene: this.scene, hemi: this.hemi, key: this.key, rim: this.rim, fill: this.fill };
    const handle = await applyHdriPreset(refs, renderer, hdriPresetId, this.hdriHandle);
    if (generation !== this.hdriGeneration || this.disposed) {
      handle?.dispose();
      return;
    }
    this.hdriHandle = handle;

    // Reports whether image-based lighting is actually live, not merely requested. A preset with no
    // `hdrUrl` is procedural-lighting-only by design and correctly reports `ibl: "none"`; the value
    // worth watching is `requested`+`none` on a preset that does carry an `hdrUrl`, which is what a
    // regression of the WebGPU env-map path would look like from the outside.
    recordMetric({
      name: "environment_applied",
      labels: {
        ibl: this.scene.environment ? "active" : "none",
        backend: isWebGLRendererLike(renderer) ? "webgl" : "webgpu",
      },
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.hdriHandle?.dispose();
    this.hdriHandle = null;
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    this.grid.dispose();
    disposeStarfield(this.stars);
    disposeTrailRocks(this.rocks);
  }
}

/** Ceiling for the starfield buffer. Matches the `high` tier's `starfieldCount` in
 * `lib/three/quality.ts` — the allocation is sized once for the most demanding tier so lower tiers
 * are a draw-range narrowing rather than a reallocation. */
const MAX_STARFIELD_COUNT = 400;

/**
 * Draws only the first `count` points of the shared starfield buffer.
 *
 * Positions are generated by uniform sampling, so any prefix is itself a uniform subsample of the
 * sky — thinning by draw range is visually equivalent to having generated fewer stars, without
 * touching the buffer. Clamped because a tier table is data and could name a count above the
 * ceiling; `setDrawRange` past the end silently renders nothing, which would read as "the stars
 * broke" rather than "the tier is misconfigured".
 */
function setStarfieldCount(points: THREE.Points, count: number): void {
  const clamped = Math.max(0, Math.min(Math.floor(count), MAX_STARFIELD_COUNT));
  points.geometry.setDrawRange(0, clamped);
}

/** A fixed field of distant points, shown only for the Night preset — cheap set dressing that
 * sells the "outdoor at night" read the flat dark background alone doesn't. */
function createStarfield(count = MAX_STARFIELD_COUNT): THREE.Points {
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
