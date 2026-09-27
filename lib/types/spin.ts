import type { MediaAsset } from "./vehicle";

export const EXTERIOR_SPIN_SCHEMA_VERSION = "1.0.0" as const;

export type ExteriorSpinSource = {
  kind: "photo" | "render";
  provenanceId?: string;
};

export interface ExteriorSpin {
  id: string;
  schemaVersion: typeof EXTERIOR_SPIN_SCHEMA_VERSION;
  vehicleSlug: string;
  modelYear: number;
  gradeId: string;
  paintCode: string;
  frameCount: 24;
  degreesPerFrame: 15;
  zeroAngle: "front";
  direction: "clockwise";
  width: number;
  height: number;
  frames: MediaAsset[];
  source: ExteriorSpinSource;
}