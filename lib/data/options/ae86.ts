import type { CustomizationOption } from "../../types/customization";

/**
 * AE86 customization catalog.
 *
 * `public/models/toyota-ae86-ivofficial.glb` is a real, minimal FBX2glTF export: 7 nodes total
 * (`RootNode`, `Car`, `Wheel1`–`Wheel4`, `Camera`) and exactly **one** material in the whole file,
 * named `Body`, reused across the `Car` mesh and all four `Wheel*` meshes (confirmed by parsing the
 * GLB's JSON chunk directly — see `lib/tooling/glbInspect.ts`). No separate glass/chrome/trim/tire
 * materials, no `MOUNT_*` attachment points.
 *
 * That single shared material does not block a `Car`-only paint option: `lib/three/materials.ts`'s
 * `MaterialWriter` clones per mesh instance (`mesh.uuid:slotIndex`), not by shared material identity,
 * so targeting only `Car` leaves `Wheel1`–`Wheel4` untouched — the same guarantee the 4Runner's
 * `metal.chrome` (shared by six nodes) already relies on.
 *
 * ## Why a material split cannot rescue this catalog (investigated for #26)
 *
 * #26 proposes authoring separate glass/chrome/trim materials so this catalog can grow. That is not
 * achievable from the shipped asset by any scripted means, and the reason is worth recording so the
 * investigation is not repeated:
 *
 * The single `Body` material carries one 256x256 `Palette.png` baseColorTexture, and **that texture
 * is baked lighting, not a material atlas**. Sampling every triangle's centroid UV against the
 * decoded PNG gives **128 distinct colours across the `Car` mesh** in smooth gradients
 * (`#9bb3bd`, `#a4bac3`, `#c195b6`, `#e2b2db`, ...) — shading variation, not flat per-material
 * swatches. There is no discrete region a "glass" or "chrome" material could be cut along.
 *
 * Splitting `Body` into `Body` + `Wheel` by mesh *is* trivially possible, since `Wheel1`–`Wheel4`
 * are separate meshes. It would unlock nothing: the wheel's sampled colours run from `#201309`
 * (tire) to `#f5ac9a` (baked-lit rim) continuously, so a colour applied to a `Wheel` material still
 * multiplies rim and tire together — exactly the outcome the paragraph below already predicted. A
 * split that adds a material name without adding a capability is worse than none, because the
 * catalog would then imply a wheel finish it cannot honour.
 *
 * Making this vehicle configurable needs a re-authored source model with real material assignments,
 * not a transform over this export. Until then the paint-only catalog is the honest surface.
 *
 * Deliberately NOT included here, and why:
 * - A "wheel finish" option targeting `Wheel1`–`Wheel4` would be mechanically safe the same way, but
 *   each wheel mesh's baked texture region covers rim *and* tire together with no material split —
 *   tinting the slot would tint the tire rubber too. Confirmed by the palette sampling above, not
 *   merely suspected.
 * - The procedural accessories (`lib/three/proceduralParts.ts` — roof rack, light bar, rock sliders)
 *   are hand-positioned in local coordinates tuned to the 4Runner/procedural body's proportions; this
 *   is a much smaller, differently-shaped 1980s coupe, so attaching them would misplace the geometry,
 *   not just look thematically wrong (unlike Camry's purely thematic exclusion of the same options).
 * - No separate tire/trim material exists, so no tire-lettering/trim options are possible.
 *
 * Colours are pulled from `lib/data/vehicles/ae86.ts`'s own `exteriorColors`/`grades`, rather than
 * invented, so a paint option's label, hex, and grade gating always match the vehicle's own data.
 */

const VEHICLE = ["ae86"];

const PAINT_NODES = ["Car"];
const PAINT_MATERIALS = ["Body"];

function paint(id: string, label: string, color: string, gradeIds?: string[]): CustomizationOption {
  return {
    id,
    category: "paint",
    label,
    operation: "material-update",
    targetNodes: PAINT_NODES,
    targetMaterials: PAINT_MATERIALS,
    // The source material is a baked, non-PBR FBX import (metalness 0.4 / roughness 0.27, no
    // clearcoat extension) — matched here rather than the higher-clearcoat values the other
    // vehicles' fresh GLB paint uses, since this material won't honor clearcoat fields at all.
    materialConfig: { color, metalness: 0.4, roughness: 0.27 },
    ...(gradeIds ? { compatibleGradeIds: gradeIds } : {}),
    compatibleVehicleIds: VEHICLE,
  };
}

export const ae86Options: CustomizationOption[] = [
  // Matches lib/data/vehicles/ae86.ts's exteriorColors exactly: code, name, hex, and grade gating.
  paint("paint-040-super-white", "Super White", "#f2f2ef"),
  paint("paint-202-black", "Black", "#101215"),
  paint("paint-3p0-classic-red", "Classic Red", "#b3141c", ["gt-s"]),
];
