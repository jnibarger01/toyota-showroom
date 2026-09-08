import * as THREE from "three";
import { VehicleSceneController } from "../three/sceneController";
import type { SceneRegistryEntry } from "../three/sceneRegistry";
import type { SemanticCapability } from "../types/sceneMap";
import type { CustomizationCategory, SelectionMap } from "../types/customization";
import type { PaintStudioState } from "../types/paintStudio";
import type { CameraController, CameraControllerState } from "../three/cameraController";
import type { CameraPresetConfig } from "../types/vehicle";

/**
 * The typed local API a future governed MCP adapter would expose to Hermes/Codex-style agents —
 * mission Priority 7. This module is the boundary itself, not the adapter: nothing here talks to
 * MCP, and everything here works standalone today, called from ordinary application code exactly
 * like any other typed API. "MCP is an adapter, not the authority" (mission Non-Goals) — an MCP
 * server built later would be a thin transport wrapping `VehicleSceneAgentApi`, translating each
 * capability to a tool call and back, not a second place scene mutations are implemented.
 *
 * Two rules shape everything below:
 *
 * 1. **No raw Three.js.** Every read returns plain, serializable data (ids, labels, numbers,
 *    tuples) — never a `THREE.Object3D`, `Material`, or any live scene reference an agent could
 *    hold onto and mutate directly. `PartSummary` is the read-side vocabulary; nothing else leaves
 *    this module.
 * 2. **Mutations are opaque-id calls into the existing, already-governed surface.** `setPaint`,
 *    `setWheels`, and `setAccessory` take a catalog `optionId` and resolve it through
 *    `VehicleSceneController.getOption` — the same lookup `applyConfiguration` already uses — so a
 *    caller can select "which listed option" but can never supply a raw node name, material name,
 *    or asset URL of its own. That is what makes wrapping `mutate` in a future ACS authorization
 *    check a matter of gating the call, not redesigning the surface: the input is already a short,
 *    validated string, never freeform scene data.
 *
 * `read`/`mutate` are kept as two explicitly-named entry points (rather than one flat method list)
 * specifically so a caller — today's application code, tomorrow's ACS-wrapped MCP tool dispatch —
 * can apply a blanket policy ("reads are always allowed; mutations need authorization") without
 * inspecting each capability individually.
 *
 * ## Camera capabilities (Priority 4)
 *
 * `camera` is a second, optional constructor argument — a `CameraController` (`lib/three/
 * cameraController.ts`, Priority 3). Composed alongside `VehicleSceneController`, not reached into:
 * `mutate.focusPart` calls `read.focusPart` for the bounding sphere and hands it straight to
 * `camera.focusPoint`, the exact seam `docs/AGENT_API.md`'s "next evolution" section described
 * before either half existed. `camera` is optional because nothing in the live app constructs this
 * class with one yet (`VehicleSceneAgentApi` itself is not wired into `VehicleCanvas.tsx` — see that
 * doc's "runtime remains usable without MCP" section); every camera-side read returns `undefined`
 * and every camera-side mutation fails closed with a reason when it is absent, rather than silently
 * doing nothing or throwing.
 */

// --- Read-side vocabulary: what leaves this module -------------------------------------------

export interface PartSummary {
  id: string;
  type: string;
  label: string;
  capabilities: readonly SemanticCapability[];
}

export interface SceneInspection {
  partCount: number;
  satisfiedPartIds: string[];
  /** Semantic parts this vehicle's scene map declares but that have no matching geometry in the
   * loaded asset (forward-declared parts, or ones only assembled at runtime) — see
   * `VehicleSceneController.sceneMapReport`. Exposed so an agent can tell "not selectable because
   * this vehicle doesn't have one" apart from "not selectable because nothing is selected". */
  unsatisfiedPartIds: string[];
  hoveredPartId: string | undefined;
  selectedPartId: string | undefined;
}

export interface FocusTarget {
  id: string;
  /** World-space bounding-sphere centre of the part's geometry — `mutate.focusPart` hands this
   * straight to `CameraController.focusPoint` (Priority 4); a caller with its own camera can use it
   * the same way without going through `mutate` at all. */
  center: [number, number, number];
  /** World-space bounding-sphere radius, for choosing a framing distance. */
  radius: number;
}

/**
 * Camera pose/state, and one catalog preset — both already plain data on `CameraController`
 * (`lib/three/cameraController.ts`), reused directly rather than redeclared: neither type holds a
 * live camera/controls reference, so both already satisfy rule 1 (module header) as-is.
 */
export type CameraStateSummary = CameraControllerState;
export type CameraPresetSummary = CameraPresetConfig;

export interface PickInput {
  /** Normalized device coordinates, each axis in [-1, 1] — see `pointerToNdc` in `lib/three/picking.ts`. */
  ndcX: number;
  ndcY: number;
}

/**
 * A camera pose as plain numbers — never a live `THREE.Camera` (rule 1, module header: no raw
 * Three.js crosses this boundary). `read.pick` builds and discards its own throwaway
 * `THREE.PerspectiveCamera` from this each call; this module still owns no camera of its own and
 * still doesn't move any camera the application is actually rendering with.
 */
export interface CameraPose {
  position: [number, number, number];
  /** World-space point the camera looks at. */
  target: [number, number, number];
  /** Vertical field of view, in degrees. */
  fov: number;
  /** Viewport aspect ratio (width / height). */
  aspect: number;
}

// --- Mutation-side vocabulary ------------------------------------------------------------------

export type MutationResult = { ok: true } | { ok: false; reason: string };

export type AgentCapabilityKind = "read" | "mutation";

export interface AgentCapabilityDescriptor {
  name: string;
  kind: AgentCapabilityKind;
  description: string;
}

/**
 * Static manifest of every capability this module exposes — what a future MCP tool listing (or
 * any other introspecting caller) would enumerate without invoking anything. Kept as plain data
 * alongside the methods, not derived by reflection, so the manifest can't silently drift from an
 * accidentally-exported extra method — every entry here is deliberately declared.
 */
export const AGENT_CAPABILITIES: readonly AgentCapabilityDescriptor[] = [
  { name: "scene.inspect", kind: "read", description: "Summary counts and load state for the current vehicle scene." },
  { name: "scene.listParts", kind: "read", description: "Every semantically-addressable part, optionally filtered by type or capability." },
  { name: "scene.getPart", kind: "read", description: "A single part's summary by semantic id." },
  { name: "scene.focusPart", kind: "read", description: "World-space bounding info for a part, for a camera to frame." },
  { name: "scene.pick", kind: "read", description: "Resolves a normalized-device-coordinate pick to a part summary, without selecting it." },
  { name: "vehicle.selectPart", kind: "mutation", description: "Selects a part by semantic id (or clears selection with undefined)." },
  { name: "vehicle.hoverPart", kind: "mutation", description: "Sets/clears the hover highlight on a part by semantic id." },
  { name: "vehicle.setPaint", kind: "mutation", description: "Applies a catalog paint option by id." },
  { name: "vehicle.setWheels", kind: "mutation", description: "Applies a catalog wheel option by id." },
  { name: "vehicle.setAccessory", kind: "mutation", description: "Shows or hides a catalog accessory option by id." },
  { name: "vehicle.applyConfiguration", kind: "mutation", description: "Applies a full selection map (and optional paint-studio state) in one call." },
  { name: "camera.getState", kind: "read", description: "Current camera position, orbit target, active preset id, and cinematic-tour status." },
  { name: "camera.getPresets", kind: "read", description: "Every catalog camera preset for this vehicle." },
  { name: "camera.setPreset", kind: "mutation", description: "Transitions the camera to a catalog preset by id." },
  { name: "camera.focusPart", kind: "mutation", description: "Frames a part's real bounding sphere, keeping the current viewing angle." },
  { name: "camera.orbit", kind: "mutation", description: "Orbits the camera by a spherical delta (radians), clamped to the configured limits." },
  { name: "camera.reset", kind: "mutation", description: "Returns the camera to its currently active preset." },
];

/**
 * Wraps one loaded `VehicleSceneController` and, optionally, its `CameraController` — one instance
 * per loaded scene, same lifetime as the controller(s) it wraps. Holds no state of its own beyond
 * those references, so there is nothing to dispose separately from `controller.dispose()`/
 * `camera.dispose()`, both of which stay this module's callers' responsibility, not this module's.
 */
export class VehicleSceneAgentApi {
  constructor(
    private readonly controller: VehicleSceneController,
    private readonly camera?: CameraController,
  ) {}

  listCapabilities(): readonly AgentCapabilityDescriptor[] {
    return AGENT_CAPABILITIES;
  }

  // --- read ------------------------------------------------------------------------------------

  readonly read = {
    inspect: (): SceneInspection => {
      const report = this.controller.sceneMapReport;
      return {
        partCount: this.controller.listParts().length,
        satisfiedPartIds: report.satisfied.map((e) => e.id),
        unsatisfiedPartIds: report.unsatisfied.map((u) => u.entry.id),
        hoveredPartId: this.controller.hoveredPartId,
        selectedPartId: this.controller.selectedPartId,
      };
    },

    listParts: (filter?: { type?: string; capability?: SemanticCapability }): PartSummary[] => {
      const entries = filter?.type
        ? this.controller.findPartsByType(filter.type)
        : filter?.capability
          ? this.controller.findPartsByCapability(filter.capability)
          : this.controller.listParts();
      return entries.map(toSummary);
    },

    getPart: (id: string): PartSummary | undefined => {
      const entry = this.controller.getPart(id);
      return entry ? toSummary(entry) : undefined;
    },

    focusPart: (id: string): FocusTarget | undefined => {
      const entry = this.controller.getPart(id);
      if (!entry) return undefined;
      const box = new THREE.Box3().setFromObject(entry.object);
      if (box.isEmpty()) return undefined;
      const center = box.getCenter(new THREE.Vector3());
      const radius = box.getSize(new THREE.Vector3()).length() / 2;
      return { id, center: [center.x, center.y, center.z], radius };
    },

    pick: (input: PickInput, pose: CameraPose): PartSummary | undefined => {
      const camera = new THREE.PerspectiveCamera(pose.fov, pose.aspect, 0.01, 1000);
      camera.position.set(...pose.position);
      camera.lookAt(...pose.target);
      camera.updateMatrixWorld(true);
      const result = this.controller.pickAt(new THREE.Vector2(input.ndcX, input.ndcY), camera);
      return result ? toSummary(result.entry) : undefined;
    },

    // `undefined` here means "no camera controller wired to this agent API instance" — a real,
    // typed distinction from "a camera exists but has no active preset", which `getCameraState`'s
    // own `presetId: undefined` already covers on `CameraControllerState` (see its doc comment).
    getCameraState: (): CameraStateSummary | undefined => this.camera?.getState(),

    // Same `undefined`-means-"no camera wired" distinction as `getCameraState`, kept apart from a
    // wired camera that genuinely has zero presets (an empty array — a real, if unusual, catalog
    // state, not "unavailable").
    getCameraPresets: (): CameraPresetSummary[] | undefined => this.camera?.getPresets().slice(),
  };

  // --- mutate ----------------------------------------------------------------------------------

  readonly mutate = {
    // Fail closed on an unknown id rather than delegate straight to `controller.selectPart`/
    // `hoverPart` — those are intentionally lenient at the controller layer (selecting a bogus id
    // is a safe no-op there, by design), but silently returning `{ ok: true }` for one here would
    // hand a future ACS-gated caller a false success for a mutation that changed nothing.
    // `undefined` (explicitly clearing the hover/selection) is always valid.
    selectPart: (id: string | undefined): MutationResult => {
      if (id !== undefined && !this.controller.hasPart(id)) return { ok: false, reason: `unknown part id "${id}"` };
      this.controller.selectPart(id);
      return { ok: true };
    },

    hoverPart: (id: string | undefined): MutationResult => {
      if (id !== undefined && !this.controller.hasPart(id)) return { ok: false, reason: `unknown part id "${id}"` };
      this.controller.hoverPart(id);
      return { ok: true };
    },

    setPaint: (optionId: string): Promise<MutationResult> => this.applyByCategory(optionId, "paint"),
    setWheels: (optionId: string): Promise<MutationResult> => this.applyByCategory(optionId, "wheels"),

    setAccessory: async (optionId: string, enabled: boolean): Promise<MutationResult> => {
      const option = this.controller.getOption(optionId);
      if (!option) return { ok: false, reason: `unknown option id "${optionId}"` };
      if (option.category !== "accessory") return { ok: false, reason: `"${optionId}" is not an accessory option` };
      const applied = enabled ? await this.controller.applyOption(option) : await this.controller.removeOption(option);
      return applied ? { ok: true } : { ok: false, reason: `"${optionId}" could not be applied to this vehicle` };
    },

    applyConfiguration: async (
      selections: SelectionMap,
      paintStudio?: PaintStudioState,
    ): Promise<{ applied: string[]; failed: string[] }> => this.controller.applyConfiguration(selections, paintStudio),

    // --- camera (Priority 4) ---------------------------------------------------------------------
    // Every method below fails closed with `{ ok: false }` when no `CameraController` was passed to
    // the constructor — never a silent no-op, matching the same standard `selectPart`/`hoverPart`
    // apply to an unknown part id above.

    setPreset: (presetId: string): MutationResult => {
      if (!this.camera) return { ok: false, reason: "no camera controller wired to this agent API instance" };
      const preset = this.camera.getPresets().find((candidate) => candidate.id === presetId);
      if (!preset) return { ok: false, reason: `unknown camera preset id "${presetId}"` };
      this.camera.transitionToPreset(preset);
      return { ok: true };
    },

    // Composes `read.focusPart` (bounding sphere, real geometry) with `CameraController.focusPoint`
    // (camera move) — the exact seam docs/AGENT_API.md's "next evolution" section described, rather
    // than this module reimplementing bounding-box math or the camera owning scene-registry lookups.
    focusPart: (id: string): MutationResult => {
      if (!this.camera) return { ok: false, reason: "no camera controller wired to this agent API instance" };
      const target = this.read.focusPart(id);
      if (!target) return { ok: false, reason: `"${id}" is unknown or has no focusable geometry on this vehicle` };
      this.camera.focusPoint(target.center, target.radius);
      return { ok: true };
    },

    orbit: (deltaTheta: number, deltaPhi: number): MutationResult => {
      if (!this.camera) return { ok: false, reason: "no camera controller wired to this agent API instance" };
      if (!Number.isFinite(deltaTheta) || !Number.isFinite(deltaPhi)) {
        return { ok: false, reason: "deltaTheta/deltaPhi must be finite numbers" };
      }
      this.camera.orbitBy(deltaTheta, deltaPhi);
      return { ok: true };
    },

    // Returns to whichever preset is currently active (`CameraController.getState().presetId`) —
    // the same "back to the active preset" semantics the pre-Priority-3 Home-key handler had, not a
    // fixed "first preset" default.
    reset: (): MutationResult => {
      if (!this.camera) return { ok: false, reason: "no camera controller wired to this agent API instance" };
      const { presetId } = this.camera.getState();
      const preset = this.camera.getPresets().find((candidate) => candidate.id === presetId);
      if (!preset) return { ok: false, reason: `active preset id "${presetId}" is not in the current preset list` };
      this.camera.resetToPreset(preset);
      return { ok: true };
    },
  };

  private async applyByCategory(optionId: string, category: CustomizationCategory): Promise<MutationResult> {
    const option = this.controller.getOption(optionId);
    if (!option) return { ok: false, reason: `unknown option id "${optionId}"` };
    if (option.category !== category) return { ok: false, reason: `"${optionId}" is not a ${category} option` };
    const applied = await this.controller.applyOption(option);
    return applied ? { ok: true } : { ok: false, reason: `"${optionId}" could not be applied to this vehicle` };
  }
}

function toSummary(entry: SceneRegistryEntry): PartSummary {
  return { id: entry.id, type: entry.type, label: entry.label, capabilities: entry.capabilities };
}
