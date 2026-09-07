import * as THREE from "three";
import { VehicleSceneController } from "../three/sceneController";
import type { SceneRegistryEntry } from "../three/sceneRegistry";
import type { SemanticCapability } from "../types/sceneMap";
import type { CustomizationCategory, SelectionMap } from "../types/customization";
import type { PaintStudioState } from "../types/paintStudio";

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
  /** World-space bounding-sphere centre of the part's geometry, for a camera controller (owned
   * outside this module today — see "What is not wired yet" below) to frame. */
  center: [number, number, number];
  /** World-space bounding-sphere radius, for choosing a framing distance. */
  radius: number;
}

export interface PickInput {
  /** Normalized device coordinates, each axis in [-1, 1] — see `pointerToNdc` in `lib/three/picking.ts`. */
  ndcX: number;
  ndcY: number;
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
];

/**
 * Wraps one loaded `VehicleSceneController`. One instance per loaded scene, same lifetime as the
 * controller it wraps — this holds no state of its own beyond that reference, so there is nothing
 * to dispose separately from `controller.dispose()`.
 */
export class VehicleSceneAgentApi {
  constructor(private readonly controller: VehicleSceneController) {}

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

    pick: (input: PickInput, camera: THREE.Camera): PartSummary | undefined => {
      const result = this.controller.pickAt(new THREE.Vector2(input.ndcX, input.ndcY), camera);
      return result ? toSummary(result.entry) : undefined;
    },
  };

  // --- mutate ----------------------------------------------------------------------------------

  readonly mutate = {
    selectPart: (id: string | undefined): MutationResult => {
      this.controller.selectPart(id);
      return { ok: true };
    },

    hoverPart: (id: string | undefined): MutationResult => {
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
