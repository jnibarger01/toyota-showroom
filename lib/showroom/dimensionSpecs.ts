/**
 * The catalog's overall dimensions, as the dimensions overlay (`lib/three/dimensions.ts`) labels
 * them. Kept free of `three` so the builder chrome can derive them without pulling the renderer into
 * its entry chunk.
 */

export interface DimensionSpec {
  key: "length" | "width" | "height";
  label: string;
  /** Catalog value in inches, when the vehicle publishes one. */
  inches?: number;
}

/** Catalog spec entries → the three overall dimensions. Other spec keys are ignored. */
export function dimensionSpecsFrom(specs: ReadonlyArray<{ key: string; value: unknown }>): DimensionSpec[] {
  const lookup = (key: string) => {
    const value = specs.find((spec) => spec.key === key)?.value;
    return typeof value === "number" ? value : undefined;
  };
  return [
    { key: "length", label: "Length", inches: lookup("length_in") },
    { key: "width", label: "Width", inches: lookup("width_in") },
    { key: "height", label: "Height", inches: lookup("height_in") },
  ];
}

