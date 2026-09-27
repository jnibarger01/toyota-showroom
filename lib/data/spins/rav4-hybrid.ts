import { EXTERIOR_SPIN_SCHEMA_VERSION, type ExteriorSpin } from "../../types/spin";
import type { MediaAsset } from "../../types/vehicle";

const FRAME_COUNT = 24 as const;
const WIDTH = 1600;
const HEIGHT = 1000;

function frames(paintCode: string): MediaAsset[] {
  return Array.from({ length: FRAME_COUNT }, (_, frame) => {
    const index = String(frame).padStart(2, "0");
    return {
      url: `/spins/rav4-hybrid/${paintCode.toLowerCase()}/${index}.webp`,
      alt: `2023 Toyota RAV4 Hybrid exterior at ${frame * 15} degrees`,
      width: WIDTH,
      height: HEIGHT,
    };
  });
}

function spin(gradeId: "le" | "xle" | "limited", paintCode: "040" | "1G3"): ExteriorSpin {
  return {
    id: `rav4-hybrid-2023-${gradeId}-${paintCode.toLowerCase()}`,
    schemaVersion: EXTERIOR_SPIN_SCHEMA_VERSION,
    vehicleSlug: "rav4-hybrid",
    modelYear: 2023,
    gradeId,
    paintCode,
    frameCount: FRAME_COUNT,
    degreesPerFrame: 15,
    zeroAngle: "front",
    direction: "clockwise",
    width: WIDTH,
    height: HEIGHT,
    frames: frames(paintCode),
    source: {
      kind: "render",
      provenanceId: "public/models/rav4-hybrid-2023/rav4-hybrid.glb",
    },
  };
}

/**
 * Pilot OEM visual coverage. The authored RAV4 Hybrid GLB is shared across these grades today,
 * so LE/XLE/Limited can reference the same paint renders without duplicating image bytes. When
 * grade-specific exterior geometry lands, give each grade its own generated frame directory.
 */
export const rav4HybridExteriorSpins: ExteriorSpin[] = [
  spin("le", "040"),
  spin("le", "1G3"),
  spin("xle", "040"),
  spin("xle", "1G3"),
  spin("limited", "040"),
  spin("limited", "1G3"),
];