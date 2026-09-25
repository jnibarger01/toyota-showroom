// Types only: the builder chrome imports `LAMP_MODES` from here, and a runtime `three` import would
// drag the whole renderer into the builder's entry chunk (`npm run bundle:budget`).
import type * as THREE from "three";

/**
 * Vehicle lamp states — daytime running lights, low beam, brake, hazards — driven through the
 * emissive regions the scene map already names (`headlight.beam`, `taillight.brakelight`, …).
 *
 * Emissive only, no real light sources: a `SpotLight` per headlamp would add shadow-casting lights
 * to a scene the quality ladder already fights to keep affordable, for a beam that mostly lands
 * outside the frame. What sells "the lights are on" in a showroom is the lamp itself glowing, and
 * its reflection in the floor (`FloorReflection` picks up the material swap for free).
 *
 * Writes go through the scene controller's `MaterialWriter`, i.e. clone-on-write: the 4Runner's
 * `emissive.turnsignal` is shared with other meshes, and blinking one set of indicators must not
 * blink a sibling that happens to share the material.
 */

export type LampRole = "drl" | "lowBeam" | "fog" | "tail" | "brake" | "turn";

/** `"modeled"` leaves every lamp exactly as the asset authored it — the default, and the only state
 * that writes nothing. */
export type LampMode = "modeled" | "off" | "drl" | "low" | "brake" | "hazard";

/** `label` is the short toolbar text; `description` is for tooltips and announcements. */
export const LAMP_MODES: ReadonlyArray<{ id: LampMode; label: string; description: string }> = [
  { id: "modeled", label: "Default", description: "Lamps as modeled" },
  { id: "off", label: "Off", description: "All lamps off" },
  { id: "drl", label: "DRL", description: "Daytime running lights" },
  { id: "low", label: "Low beam", description: "Low beams, fog and tail lamps" },
  { id: "brake", label: "Brake", description: "Brake lights on" },
  { id: "hazard", label: "Hazards", description: "Hazard lights flashing" },
];

/**
 * A semantic part id's lamp role, or `null` for lenses, bezels and housings — which are glass and
 * plastic, not emitters. Keyed on the id suffix so every vehicle whose scene map follows the
 * existing naming (`*.brakelight`, `*.turnsignal`) is covered without a per-vehicle table.
 */
export function lampRoleFor(partId: string): LampRole | null {
  if (partId === "headlight.beam") return "lowBeam";
  if (partId === "headlight.sidelight") return "drl";
  if (partId === "light.foglight") return "fog";
  if (partId === "taillight.beam") return "tail";
  if (partId.endsWith(".brakelight")) return "brake";
  if (partId.endsWith(".turnsignal")) return "turn";
  return null;
}

/** Which roles glow in each mode. Tail lamps ride with any front lamp, as on the real vehicle. */
export function rolesLitBy(mode: LampMode): ReadonlySet<LampRole> {
  switch (mode) {
    case "drl":
      return new Set(["drl", "tail"]);
    case "low":
      return new Set(["drl", "lowBeam", "fog", "tail"]);
    case "brake":
      return new Set(["drl", "tail", "brake"]);
    case "hazard":
      return new Set(["drl", "tail", "turn"]);
    default:
      return new Set();
  }
}

/**
 * How much brighter than as-modeled a lit lamp of each role glows. Authors already tune lamp
 * emission to their asset's scale (the 4Runner's side lights are authored at emissive strength 30,
 * its brake lamps at 3), so "on" is the authored emission scaled — a fixed absolute value would be
 * darker than the asset's own default on some vehicles and blinding on others. Brake and low beam
 * are boosted because as-modeled they read as tail/parking brightness, and pressing the brake has to
 * visibly change something.
 */
const ROLE_BOOST: Record<LampRole, number> = { drl: 1, lowBeam: 4, fog: 1, tail: 1, brake: 3, turn: 1 };

/** Authored emission below this (max channel × intensity) counts as "not authored to glow". */
const AUTHORED_GLOW_THRESHOLD = 0.5;

/** Fallback colour and strength for a lamp the asset authored dark. Pre-tone-mapping values;
 * Neutral tone mapping keeps the hue of a saturated red/amber rather than washing it to white. */
const ROLE_LOOK: Record<LampRole, { color: string; intensity: number }> = {
  drl: { color: "#f4f7ff", intensity: 2.5 },
  lowBeam: { color: "#fff4e2", intensity: 5 },
  fog: { color: "#fff1d6", intensity: 3 },
  tail: { color: "#ff2a1a", intensity: 1.6 },
  brake: { color: "#ff1a10", intensity: 5 },
  turn: { color: "#ffa21a", intensity: 4.5 },
};

/** Hazard flash rate. 1.5 Hz is inside the real-world 1–2 Hz indicator range and well under the
 * 3 Hz photosensitivity threshold (WCAG 2.3.1). */
export const HAZARD_HZ = 1.5;

export interface LampBinding {
  role: LampRole;
  mesh: THREE.Mesh;
  materialNames: readonly string[];
}

/** The slice of `MaterialWriter` this needs — kept narrow so tests can use a plain writer. */
export interface EmissiveWriter {
  updateMaterials(
    meshes: readonly THREE.Mesh[],
    materialNames: readonly string[] | undefined,
    update: (material: THREE.Material, mesh: THREE.Mesh) => void,
  ): number;
}

type EmissiveMaterial = THREE.Material & { emissive?: THREE.Color; emissiveIntensity?: number };

export class VehicleLights {
  private readonly bindings: readonly LampBinding[];
  private readonly writer: EmissiveWriter;
  /** As-authored emissive per cloned material, captured the first time this module writes it. */
  private readonly authored = new WeakMap<THREE.Material, { color: THREE.Color; intensity: number }>();
  private mode: LampMode = "modeled";
  /** Last hazard blink phase written, so a steady frame writes nothing. */
  private blinkOn: boolean | null = null;

  constructor(bindings: readonly LampBinding[], writer: EmissiveWriter) {
    this.bindings = bindings;
    this.writer = writer;
  }

  /** Modes this vehicle can actually show — `modeled`/`off` plus any whose roles it has lamps for. */
  availableModes(): LampMode[] {
    const roles = new Set(this.bindings.map((binding) => binding.role));
    if (roles.size === 0) return [];
    return LAMP_MODES.map((mode) => mode.id).filter((mode) => {
      if (mode === "modeled" || mode === "off") return true;
      const lit = rolesLitBy(mode);
      // A mode is worth offering only if its *distinguishing* role exists (brake needs brake lamps).
      const distinguishing: Record<string, LampRole> = { drl: "drl", low: "lowBeam", brake: "brake", hazard: "turn" };
      return roles.has(distinguishing[mode]!) && [...lit].some((role) => roles.has(role));
    });
  }

  get currentMode(): LampMode {
    return this.mode;
  }

  setMode(mode: LampMode): void {
    this.mode = mode;
    this.blinkOn = null;
    this.apply(true);
  }

  /**
   * Re-applies the current mode. The scene controller calls this after `applyConfiguration`, whose
   * `restoreOriginals` drops every cloned material — lamp state included.
   */
  reapply(): void {
    // `restoreOriginals` already put the as-modeled materials back; writing them again would only
    // clone every lamp material for nothing.
    if (this.mode === "modeled") return;
    this.blinkOn = null;
    this.apply(true);
  }

  /**
   * Per-frame hook for the hazard blink. `steady` (reduced motion) holds the indicators on rather
   * than flashing them. Writes only when the blink phase actually changes.
   */
  update(nowMs: number, steady: boolean): void {
    if (this.mode !== "hazard") return;
    const on = steady || Math.floor((nowMs / 1000) * HAZARD_HZ * 2) % 2 === 0;
    if (on === this.blinkOn) return;
    this.blinkOn = on;
    this.apply(on);
  }

  private apply(turnOn: boolean): void {
    const lit = rolesLitBy(this.mode);
    for (const binding of this.bindings) {
      this.writer.updateMaterials([binding.mesh], binding.materialNames, (material) => {
        const emissive = material as EmissiveMaterial;
        if (!emissive.emissive) return;
        if (!this.authored.has(material)) {
          this.authored.set(material, { color: emissive.emissive.clone(), intensity: emissive.emissiveIntensity ?? 1 });
        }
        const authored = this.authored.get(material)!;
        if (this.mode === "modeled") {
          emissive.emissive.copy(authored.color);
          emissive.emissiveIntensity = authored.intensity;
          return;
        }
        const on = lit.has(binding.role) && (binding.role !== "turn" || turnOn);
        if (on) {
          const authoredGlow = Math.max(authored.color.r, authored.color.g, authored.color.b) * authored.intensity;
          if (authoredGlow >= AUTHORED_GLOW_THRESHOLD) {
            emissive.emissive.copy(authored.color);
            emissive.emissiveIntensity = authored.intensity * ROLE_BOOST[binding.role];
          } else {
            const look = ROLE_LOOK[binding.role];
            emissive.emissive.set(look.color);
            emissive.emissiveIntensity = look.intensity;
          }
        } else {
          emissive.emissive.setRGB(0, 0, 0);
          emissive.emissiveIntensity = 0;
        }
      });
    }
  }
}
