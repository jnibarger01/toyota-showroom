import type { CustomizationOption } from "../../types/customization";
import { PAINT_CUSTOM_OPTION_ID, PAINT_CUSTOM_PRICE_DELTA } from "../paintStudio";
import { PAINT_FINISHES, PAINT_FINISH_GROUP, paintFinishOptionId } from "../paintFinishes";

/**
 * Paint catalog entries generated for every vehicle from that vehicle's own paint targets.
 *
 * Two things live here, and both were previously available on the 4Runner alone:
 *
 *  - **Finishes** (`paint-finish-*`), a second selection group in the `paint` category. They write
 *    surface properties only, so they compose with whichever colour the vehicle's own catalog
 *    offers rather than replacing it — see `lib/data/paintFinishes.ts`.
 *  - **The Paint Studio sentinel** (`paint-custom`), which until now was hand-written in
 *    `lib/data/options/4runner.ts` and therefore offered on exactly one of eight vehicles.
 *
 * ## Targets come from the vehicle, not from a constant
 *
 * Every vehicle paints a different slot: `BODY`/`body.carmain` on the 4Runner, Tacoma and RAV4,
 * `CAMRY_EX_*`/`CarPaint` on the Camry, `Car`/`Body` on the AE86, `Paint_Paint_0`/`Paint` on the
 * Supra, and two more shapes again on the RAV4 Hybrid and Land Cruiser. Rather than duplicate those
 * eight target lists, each generated option borrows them from the vehicle's first catalog paint
 * option — the same technique `lib/data/options/runtimeMods.ts` already uses for its Satin
 * Graphite. A vehicle with no paint option of its own gets no generated paint options either, which
 * is the correct outcome: there is nothing to paint.
 */

/** The catalog paint option whose targets the generated options borrow. */
function paintTemplate(baseOptions: readonly CustomizationOption[]): CustomizationOption | undefined {
  return baseOptions.find(
    (option) =>
      option.category === "paint" &&
      option.operation === "material-update" &&
      option.id !== PAINT_CUSTOM_OPTION_ID &&
      option.targetNodes?.length,
  );
}

export function getPaintProgramOptions(
  vehicleId: string,
  baseOptions: readonly CustomizationOption[],
): CustomizationOption[] {
  const template = paintTemplate(baseOptions);
  if (!template) return [];

  const targets = {
    targetNodes: [...(template.targetNodes ?? [])],
    targetMaterials: [...(template.targetMaterials ?? [])],
  };
  const options: CustomizationOption[] = [];

  // The Paint Studio sentinel. Skipped where a vehicle's own catalog already declares it, so the
  // 4Runner's hand-written entry stays the single definition for that vehicle rather than being
  // silently shadowed by a duplicate id.
  if (!baseOptions.some((option) => option.id === PAINT_CUSTOM_OPTION_ID)) {
    options.push({
      id: PAINT_CUSTOM_OPTION_ID,
      category: "paint",
      label: "Custom Paint Studio",
      operation: "material-update",
      ...targets,
      // Only a starting point: custom mode's real values live on
      // `VehicleConfiguration.paintStudio` as schema-safe numbers, and the scene resolves them onto
      // these same catalog-owned targets. Nothing about the custom colour is ever client-authored.
      materialConfig: { color: "#1558d6", metalness: 0.65, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 },
      priceDelta: PAINT_CUSTOM_PRICE_DELTA,
      compatibleVehicleIds: [vehicleId],
    });
  }

  for (const finish of PAINT_FINISHES) {
    options.push({
      id: paintFinishOptionId(finish.id),
      category: "paint",
      selectionGroup: PAINT_FINISH_GROUP,
      groupLabel: "Finish",
      label: finish.label,
      operation: "material-update",
      ...targets,
      // No `color`: the selected colour has to survive a finish change. See `paintFinishes.ts`.
      materialConfig: { ...finish.surface },
      ...(finish.priceDelta ? { priceDelta: finish.priceDelta } : {}),
      compatibleVehicleIds: [vehicleId],
    });
  }

  return options;
}
