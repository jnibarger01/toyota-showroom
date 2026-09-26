import * as THREE from "three";

/**
 * Tap-to-place for the immersive-AR session: a reticle tracks the real floor under the centre of the
 * view (WebXR hit-testing), and a tap sets the vehicle down there, at true scale.
 *
 * What #16's first pass deliberately left out ("no hit-testing, plane detection, or placement UI"):
 * `local-floor` alone drops the vehicle at the viewer's feet, wherever they happen to be standing —
 * usually half inside a wall. Placement is what makes "see it in your driveway" actually work.
 *
 * Hit-testing is an *optional* session feature, the same way `local-floor` is (`xrSession.ts`
 * explains why required features defeat their own fallback): without it the vehicle is shown where
 * it was before, in front of the viewer, and the reticle never appears.
 *
 * ## True scale
 *
 * The models' units are only approximately metres (they came from four different pipelines). In a
 * showroom that is invisible; in AR, next to a real car, a 10% error is obvious. `trueScaleFactor`
 * uses the catalog's published overall length — the same figure the dimensions overlay prints — to
 * scale the placed vehicle to its real size.
 */

/** Structural slices of the WebXR types this needs, so tests can drive it with plain objects. */
export interface HitTestFrame {
  getHitTestResults(source: unknown): ReadonlyArray<{ getPose(space: unknown): { transform: { matrix: Float32Array | number[] } } | null | undefined }>;
}

export interface PlacementSession {
  requestReferenceSpace(type: "viewer"): Promise<unknown>;
  requestHitTestSource?: (options: { space: unknown }) => Promise<{ cancel(): void }> | undefined;
  addEventListener(type: "select", listener: () => void): void;
  removeEventListener(type: "select", listener: () => void): void;
}

/** Ratio that brings the model's length to the catalog's. `1` when there is nothing to scale by, or
 * when the correction would be implausible (a unit mismatch, not a small modelling error). */
export function trueScaleFactor(measuredLengthMeters: number, catalogLengthInches: number | undefined): number {
  if (!catalogLengthInches || measuredLengthMeters <= 0) return 1;
  const factor = (catalogLengthInches * 0.0254) / measuredLengthMeters;
  return factor > 0.5 && factor < 2 ? factor : 1;
}

/** Surfaces tilted more than this from level are not a floor (a wall, a door, a steep ramp). */
export const MAX_FLOOR_TILT_DEGREES = 15;

/**
 * Whether a hit-test pose lies on a floor-like surface. WebXR orients a hit result's pose so its
 * +Y axis is the surface normal; a floor's normal points (nearly) straight up. A wall hit would
 * otherwise set the vehicle down level at the wall's height — floating, or half inside the wall.
 */
export function isFloorLike(matrix: Float32Array | readonly number[]): boolean {
  const upX = matrix[4] ?? 0;
  const upY = matrix[5] ?? 0;
  const upZ = matrix[6] ?? 0;
  const length = Math.hypot(upX, upY, upZ) || 1;
  return upY / length >= Math.cos(THREE.MathUtils.degToRad(MAX_FLOOR_TILT_DEGREES));
}

export class ArPlacement {
  /** Flat ring on the floor where the vehicle would land; added to the scene by the caller. */
  readonly reticle: THREE.Mesh;
  private hitTestSource: { cancel(): void } | null = null;
  private referenceSpace: unknown = null;
  private readonly lastHit = new THREE.Matrix4();
  private hasHit = false;
  private placedOnce = false;
  private readonly handleSelect = () => this.place();

  constructor(
    private readonly session: PlacementSession,
    /** Applies a placement: world position on the real floor, plus the yaw to face the viewer. */
    private readonly onPlace: (position: THREE.Vector3, yaw: number) => void,
    /** The viewer's current world position, for turning the vehicle's side toward them. */
    private readonly viewerPosition: () => THREE.Vector3,
  ) {
    const geometry = new THREE.RingGeometry(0.28, 0.34, 40).rotateX(-Math.PI / 2);
    this.reticle = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85 }));
    this.reticle.name = "AR_RETICLE";
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.reticle.raycast = () => {};
  }

  /** Starts hit-testing. Resolves `false` when the session did not grant it (no placement UI then). */
  async start(frameSpace: unknown): Promise<boolean> {
    this.referenceSpace = frameSpace;
    this.session.addEventListener("select", this.handleSelect);
    if (!this.session.requestHitTestSource) return false;
    try {
      const viewer = await this.session.requestReferenceSpace("viewer");
      this.hitTestSource = (await this.session.requestHitTestSource({ space: viewer })) ?? null;
    } catch {
      this.hitTestSource = null;
    }
    return this.hitTestSource !== null;
  }

  get isPlaced(): boolean {
    return this.placedOnce;
  }

  /** Per XR frame: moves the reticle to the latest floor hit — the first one that is a floor. */
  update(frame: HitTestFrame | undefined): void {
    if (!frame || !this.hitTestSource || !this.referenceSpace) return;
    let floorPose: Float32Array | number[] | null = null;
    for (const hit of frame.getHitTestResults(this.hitTestSource)) {
      const matrix = hit.getPose(this.referenceSpace)?.transform.matrix;
      if (matrix && isFloorLike(matrix)) {
        floorPose = matrix;
        break;
      }
    }
    this.hasHit = floorPose !== null;
    this.reticle.visible = this.hasHit;
    if (floorPose) {
      this.lastHit.fromArray(Array.from(floorPose));
      this.reticle.matrix.copy(this.lastHit);
    }
  }

  /** Sets the vehicle down at the reticle, side-on to the viewer. A no-op without a floor hit. */
  place(): void {
    if (!this.hasHit) return;
    const position = new THREE.Vector3().setFromMatrixPosition(this.lastHit);
    const toViewer = this.viewerPosition().clone().sub(position);
    // Side-on reads as "a car" at a glance and shows its full length; the showroom nose is −Z, so a
    // yaw that puts +X toward the viewer shows the right-hand side.
    const yaw = Math.atan2(toViewer.x, toViewer.z) - Math.PI / 2;
    this.placedOnce = true;
    this.onPlace(position, yaw);
  }

  dispose(): void {
    this.session.removeEventListener("select", this.handleSelect);
    this.hitTestSource?.cancel();
    this.hitTestSource = null;
    this.reticle.removeFromParent();
    this.reticle.geometry.dispose();
    (this.reticle.material as THREE.Material).dispose();
  }
}
