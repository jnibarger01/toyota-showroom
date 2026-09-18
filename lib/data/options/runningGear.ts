import type { CustomizationOption } from "../../types/customization";
import { getWheelFitment } from "../wheelFitment";
import { TIRE_FINISHES, WHEEL_PACKAGE_PRICES, WHEEL_PACKAGES_BY_ID } from "../wheelPackages";
import { tiresNodeName, wheelsetNodeName, TIRE_MATERIAL_NAME } from "../../three/proceduralWheels";

/**
 * Wheel-and-tyre catalog entries, generated per vehicle from that vehicle's measured fitment.
 *
 * These are ordinary `CustomizationOption` records — same ids-only contract, same node-name
 * contract, same `verifyNodeContract` gate. Nothing here is a special case downstream: a package is
 * a `mesh-visibility` option over the `WHEELSET_*` groups `installProceduralWheelPackages` mounts,
 * and a sidewall finish is a `material-update` over the `tire.sidewall` slot those groups carry.
 *
 * Both live in the `wheels` category — the builder's rail already calls it "Wheels & Tires" — and
 * are separated by `selectionGroup`, so a package and a sidewall finish are chosen independently
 * while each remains single-select on its own.
 */

/** Selection groups within the `wheels` category: which package is fitted, and how it is finished. */
const PACKAGE_GROUP = "wheels";
const TIRE_GROUP = "tire-sidewall";

/** Stable option id for a package on any vehicle. Packages are shared, so ids are too. */
export function wheelPackageOptionId(packageId: string): string {
  return `wheels-package-${packageId}`;
}

export function getRunningGearOptions(vehicleId: string): CustomizationOption[] {
  const fitment = getWheelFitment(vehicleId);
  if (!fitment) return [];

  const vehicle = [vehicleId];
  const wheelsetNodes = fitment.packageIds.map(wheelsetNodeName);
  const options: CustomizationOption[] = [];

  // Factory wheels first, and only for a vehicle that has any. Without this entry a package would
  // be a one-way door: `wheels` is single-select, so choosing one package hides the stock geometry,
  // and nothing in the catalog would bring it back.
  if (fitment.stockRunningGearNodes.length > 0) {
    options.push({
      id: "wheels-factory",
      category: "wheels",
      selectionGroup: PACKAGE_GROUP,
      groupLabel: "Wheel & tire package",
      label: "Factory wheels",
      operation: "mesh-visibility",
      targetNodes: [...fitment.stockRunningGearNodes],
      hidesNodes: wheelsetNodes,
      compatibleVehicleIds: vehicle,
    });
  }

  for (const packageId of fitment.packageIds) {
    const spec = WHEEL_PACKAGES_BY_ID.get(packageId);
    if (!spec) continue;
    options.push({
      id: wheelPackageOptionId(packageId),
      category: "wheels",
      selectionGroup: PACKAGE_GROUP,
      groupLabel: "Wheel & tire package",
      label: spec.label,
      operation: "mesh-visibility",
      targetNodes: [wheelsetNodeName(packageId)],
      // The stock running gear and every *other* package: one selection, one visible set of wheels,
      // stated in data rather than implied by the category's cardinality.
      hidesNodes: [
        ...fitment.stockRunningGearNodes,
        ...wheelsetNodes.filter((name) => name !== wheelsetNodeName(packageId)),
      ],
      priceDelta: WHEEL_PACKAGE_PRICES[packageId] ?? 0,
      // Runtime-generated geometry, not an authored Toyota accessory wheel. The UI labels it a
      // preview for exactly that reason: it is a faithful fitment, not a catalog part number.
      geometrySource: "procedural-preview",
      compatibleVehicleIds: vehicle,
    });
  }

  // Sidewall finishes target every package's tyres plus, where the vehicle's own tyres expose a
  // named material, the factory tyres too — so the choice survives switching between them.
  const tireNodes = [...fitment.packageIds.map(tiresNodeName), ...fitment.stockTireNodes];
  const tireMaterials = [...new Set([TIRE_MATERIAL_NAME, ...fitment.stockTireMaterials])];

  if (tireNodes.length > 0) {
    for (const finish of TIRE_FINISHES) {
      options.push({
        // Supersedes the 4Runner's and Tacoma's `trim-tire-letters-*` options, which were the only
        // tyre controls in the catalog and lived under `trim` ("Suspension" in the rail). The id
        // changes with the category, so a configuration saved against those two ids no longer
        // resolves — an accepted one-off, since the alternative is an id that permanently
        // contradicts the category it is filed under.
        id: `${TIRE_GROUP}-${finish.id}`,
        category: "wheels",
        selectionGroup: TIRE_GROUP,
        groupLabel: "Tire sidewall",
        label: finish.label,
        operation: "material-update",
        targetNodes: tireNodes,
        targetMaterials: tireMaterials,
        materialConfig: { color: finish.color, roughness: finish.roughness },
        ...(finish.priceDelta ? { priceDelta: finish.priceDelta } : {}),
        compatibleVehicleIds: vehicle,
      });
    }
  }

  return options;
}
