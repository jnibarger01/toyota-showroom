import type { SceneMapEntry } from "../../types/sceneMap";

/**
 * `toyota-ae86-ivofficial.glb` has 7 real nodes total (`RootNode`, `Car`, `Wheel1`–`Wheel4`,
 * `Camera`) and one material (`Body`) — see `lib/data/vehicles/ae86.ts`.
 *
 * Wheel translations were read directly from the GLB (`NodeIO` inspection, not guessed):
 * `{Wheel1, Wheel4}` share one local-Z group and `{Wheel2, Wheel3}` the other; `{Wheel1, Wheel3}`
 * share one local-Y group and `{Wheel4, Wheel2}` the other — the four genuinely form two consistent
 * axle/side pairs. Which pair is physically front and which is left in world space depends on the
 * root node's authored rotation, which has not been confirmed by a rendered screenshot in this
 * environment — the same caveat `lib/data/vehicles/ae86.ts`'s camera presets already carry. Rather
 * than assert a front-left/front-right label this file cannot verify, wheels are addressed by
 * their authored node index; relabel once a browser check confirms orientation.
 */
export const AE86_SCENE_MAP: SceneMapEntry[] = [
  {
    id: "vehicle.root",
    type: "vehicle",
    label: "Vehicle",
    capabilities: ["selectable"],
    match: { kind: "object", objectName: "RootNode" },
  },
  {
    id: "body.exterior",
    type: "body",
    label: "Exterior paint",
    capabilities: ["selectable", "paintable", "highlightable"],
    match: { kind: "material-region", objectName: "Car", materialNames: ["Body"] },
  },
  {
    id: "wheel.1",
    type: "wheel",
    label: "Wheel 1",
    capabilities: ["selectable", "highlightable", "wheel"],
    match: { kind: "object", objectName: "Wheel1" },
  },
  {
    id: "wheel.2",
    type: "wheel",
    label: "Wheel 2",
    capabilities: ["selectable", "highlightable", "wheel"],
    match: { kind: "object", objectName: "Wheel2" },
  },
  {
    id: "wheel.3",
    type: "wheel",
    label: "Wheel 3",
    capabilities: ["selectable", "highlightable", "wheel"],
    match: { kind: "object", objectName: "Wheel3" },
  },
  {
    id: "wheel.4",
    type: "wheel",
    label: "Wheel 4",
    capabilities: ["selectable", "highlightable", "wheel"],
    match: { kind: "object", objectName: "Wheel4" },
  },
];
