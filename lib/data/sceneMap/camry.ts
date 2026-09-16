import type { SceneMapEntry } from "../../types/sceneMap";

const region = (
  id: string,
  type: string,
  label: string,
  objectName: string,
  materialNames: string[],
  capabilities: SceneMapEntry["capabilities"] = ["selectable", "highlightable"],
): SceneMapEntry => ({
  id, type, label, capabilities,
  match: { kind: "material-region", objectName, materialNames },
});

export const CAMRY_SCENE_MAP: SceneMapEntry[] = [
  region("body.paint", "body", "Exterior paint", "CAMRY_EX_CARBODY_MESH_CarPaint_0", ["CarPaint"], ["selectable", "paintable", "highlightable"]),
  region("door.front-left", "door", "Front-left door", "CAMRY_EX_FL_DOOR_MESH_CarPaint_0", ["CarPaint"], ["selectable", "paintable", "highlightable"]),
  region("door.front-right", "door", "Front-right door", "CAMRY_EX_FR_DOOR_MESH_CarPaint_0", ["CarPaint"], ["selectable", "paintable", "highlightable"]),
  region("door.rear-left", "door", "Rear-left door", "CAMRY_EX_RL_DOOR_MESH_CarPaint_0", ["CarPaint"], ["selectable", "paintable", "highlightable"]),
  region("door.rear-right", "door", "Rear-right door", "CAMRY_EX_RR_DOOR_MESH_CarPaint_0", ["CarPaint"], ["selectable", "paintable", "highlightable"]),
  region("trunk.paint", "trunk", "Trunk", "CAMRY_EX_BOOT_DOOR_MESH_CarPaint_0", ["CarPaint"], ["selectable", "paintable", "highlightable"]),
  region("light.headlights", "light", "Headlights", "CAMRY_EX_HEADLIGHT_MESH_Glass_Light_0", ["Glass_Light"], ["selectable", "highlightable", "light"]),
  region("light.taillights", "light", "Taillights", "CAMRY_EX_TAILLIGHT_MESH_Red_glass_0", ["Red_glass"], ["selectable", "highlightable", "light"]),
  region("interior.seats", "interior", "Seats", "CAMRY_IN_SEAT_MESH_Seat_Letaher_Color_0", ["Seat_Letaher_Color"], ["selectable", "highlightable"]),
  region("wheel.finish", "wheel", "Wheel finish", "polySurface6103_Wheel_Alloy_0", ["Wheel_Alloy"], ["selectable", "highlightable", "wheel"]),
  region("brakes.caliper", "brake", "Brake caliper", "polySurface6103_Caliper_0", ["Caliper"], ["selectable", "highlightable", "accessory"]),
];