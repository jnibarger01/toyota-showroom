import type { SceneMapEntry } from "../../types/sceneMap";

const region = (id: string, type: string, label: string, objectName: string, materialNames: string[], capabilities: SceneMapEntry["capabilities"] = ["selectable", "highlightable"]): SceneMapEntry => ({ id, type, label, capabilities, match: { kind: "material-region", objectName, materialNames } });
const object = (id: string, type: string, label: string, objectName: string, capabilities: SceneMapEntry["capabilities"] = ["selectable", "highlightable"]): SceneMapEntry => ({ id, type, label, capabilities, match: { kind: "object", objectName } });

export const GR_SUPRA_SCENE_MAP: SceneMapEntry[] = [
  object("vehicle.root", "vehicle", "Vehicle", "RootNode", ["selectable"]),
  region("body.paint", "body", "Exterior paint", "Paint_Paint_0", ["Paint"], ["selectable", "paintable", "highlightable"]),
  region("door.left.paint", "door", "Left door paint", "DoorLF_Paint_Paint_0", ["Paint"], ["selectable", "paintable", "highlightable"]),
  region("door.left.paint-secondary", "door", "Left door secondary paint", "DoorLF_Paint_PaintSecondary_0", ["PaintSecondary"], ["selectable", "paintable", "highlightable"]),
  region("door.right.paint", "door", "Right door paint", "DoorRF_Paint_Paint_0", ["Paint"], ["selectable", "paintable", "highlightable"]),
  region("door.right.paint-secondary", "door", "Right door secondary paint", "DoorRF_Paint_PaintSecondary_0", ["PaintSecondary"], ["selectable", "paintable", "highlightable"]),
  region("hood.paint", "hood", "Hood paint", "Hood_Paint_Paint_0", ["Paint"], ["selectable", "paintable", "highlightable"]),
  region("trunk.paint", "trunk", "Trunk paint", "Trunk_Paint_Paint_0", ["Paint"], ["selectable", "paintable", "highlightable"]),
  region("light.main", "light", "Headlights", "Light_Lights_0", ["Lights"], ["selectable", "highlightable", "light"]),
  region("light.door-left", "light", "Left door lights", "DoorLF_Light_Lights_0", ["Lights"], ["selectable", "light"]),
  region("light.door-right", "light", "Right door lights", "DoorRF_Light_Lights_0", ["Lights"], ["selectable", "light"]),
  region("light.trunk", "light", "Rear lights", "Trunk_Light_Lights_0", ["Lights"], ["selectable", "light"]),
  region("trim.grille-1", "trim", "Grille", "Grille1_Grille1A_0", ["Grille1A"]),
  region("trim.grille-2", "trim", "Grille surround", "Grille2_Grille2A_0", ["Grille2A"]),
  region("accessory.carbon", "accessory", "Carbon trim", "Carbon1_Carbon1_0", ["Carbon1"], ["selectable", "highlightable", "accessory"]),
  region("accessory.calipers", "accessory", "Brake calipers", "CaliperRF_CaliperColor_0", ["CaliperColor"], ["selectable", "highlightable", "accessory"]),
  region("accessory.interior", "interior", "Interior accents", "Interior_InteriorColor2_0", ["InteriorColor2"]),
  region("accessory.engine", "accessory", "Engine presentation", "Engine_Engine_0", ["Engine"], ["selectable", "highlightable", "accessory"]),
  object("wheel.rear-right", "wheel", "Rear-right wheel", "Wheel_01_RR", ["selectable", "highlightable", "wheel"]),
  object("wheel.front-right", "wheel", "Front-right wheel", "Wheel_01_RF", ["selectable", "highlightable", "wheel"]),
  object("wheel.rear-left", "wheel", "Rear-left wheel", "Wheel_01_LR", ["selectable", "highlightable", "wheel"]),
  object("wheel.front-left", "wheel", "Front-left wheel", "Wheel_01_LF", ["selectable", "highlightable", "wheel"]),
  region("wheel.finish", "wheel", "Wheel finish", "Wheel_01_RR_Wheel1A_0", ["Wheel1A"], ["selectable", "highlightable", "wheel"]),
];
