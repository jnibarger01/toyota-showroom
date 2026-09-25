import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { MaterialWriter } from "../lib/three/materials";
import { lampRoleFor, rolesLitBy, VehicleLights, type LampBinding, type LampRole } from "../lib/three/vehicleLights";
import { VehicleSceneController } from "../lib/three/sceneController";
import { getSceneMapForVehicle } from "../lib/data/sceneMap";

function lamp(role: LampRole, name: string): LampBinding {
  const material = new THREE.MeshStandardMaterial({ name, emissive: "#222222", emissiveIntensity: 0.5 });
  return { role, mesh: new THREE.Mesh(new THREE.BoxGeometry(), material), materialNames: [name] };
}

const emissiveOf = (binding: LampBinding) => binding.mesh.material as THREE.MeshStandardMaterial;

describe("lampRoleFor", () => {
  it("maps the scene map's emitter ids and skips lenses and housings", () => {
    expect(lampRoleFor("headlight.beam")).toBe("lowBeam");
    expect(lampRoleFor("headlight.sidelight")).toBe("drl");
    expect(lampRoleFor("taillight.brakelight")).toBe("brake");
    expect(lampRoleFor("light.brakelight")).toBe("brake");
    expect(lampRoleFor("headlight.turnsignal")).toBe("turn");
    expect(lampRoleFor("taillight.beam")).toBe("tail");
    expect(lampRoleFor("headlight.lens")).toBeNull();
    expect(lampRoleFor("taillight.housing")).toBeNull();
  });

  it("lights tail lamps with every front mode, and brakes only in brake mode", () => {
    expect(rolesLitBy("drl").has("tail")).toBe(true);
    expect(rolesLitBy("low").has("lowBeam")).toBe(true);
    expect(rolesLitBy("low").has("brake")).toBe(false);
    expect(rolesLitBy("brake").has("brake")).toBe(true);
    expect(rolesLitBy("off").size).toBe(0);
  });
});

describe("VehicleLights", () => {
  it("offers only the modes this vehicle has lamps for, and none without lamps", () => {
    const writer = new MaterialWriter();
    expect(new VehicleLights([], writer).availableModes()).toEqual([]);
    const modes = new VehicleLights([lamp("brake", "b"), lamp("tail", "t")], writer).availableModes();
    expect(modes).toEqual(["modeled", "off", "brake"]);
  });

  it("lights the mode's roles, darkens the rest, and restores the authored look on 'modeled'", () => {
    const brake = lamp("brake", "emissive.brake");
    const beam = lamp("lowBeam", "emissive.beam");
    const lights = new VehicleLights([brake, beam], new MaterialWriter());

    lights.setMode("brake");
    expect(emissiveOf(brake).emissiveIntensity).toBeGreaterThan(1);
    expect(emissiveOf(beam).emissiveIntensity).toBe(0);

    lights.setMode("modeled");
    expect(emissiveOf(brake).emissive.getHexString()).toBe("222222");
    expect(emissiveOf(brake).emissiveIntensity).toBe(0.5);
  });

  it("scales a lamp the asset authored to glow, rather than replacing it with a dimmer fixed look", () => {
    // The 4Runner's brake material: red, emissive strength 3.
    const material = new THREE.MeshStandardMaterial({ name: "emissive.brakelights", emissive: "#ff0201", emissiveIntensity: 3 });
    const brake: LampBinding = { role: "brake", mesh: new THREE.Mesh(new THREE.BoxGeometry(), material), materialNames: ["emissive.brakelights"] };
    const lights = new VehicleLights([brake], new MaterialWriter());
    lights.setMode("brake");
    expect(emissiveOf(brake).emissiveIntensity).toBe(9);
    expect(emissiveOf(brake).emissive.getHexString()).toBe("ff0201");
  });

  it("writes through clone-on-write, so a shared lamp material is not blinked on a sibling", () => {
    const shared = new THREE.MeshStandardMaterial({ name: "emissive.turn" });
    const left: LampBinding = { role: "turn", mesh: new THREE.Mesh(new THREE.BoxGeometry(), shared), materialNames: ["emissive.turn"] };
    const bystander = new THREE.Mesh(new THREE.BoxGeometry(), shared);
    new VehicleLights([left], new MaterialWriter()).setMode("hazard");
    expect(left.mesh.material).not.toBe(shared);
    expect(bystander.material).toBe(shared);
    expect(shared.emissiveIntensity).toBe(1);
  });

  it("blinks hazards at 1.5 Hz, and holds them steady under reduced motion", () => {
    const turn = lamp("turn", "emissive.turn");
    const lights = new VehicleLights([turn], new MaterialWriter());
    lights.setMode("hazard");
    lights.update(0, false);
    const on = emissiveOf(turn).emissiveIntensity;
    lights.update(400, false); // past half a 1.5 Hz period (333 ms)
    expect(emissiveOf(turn).emissiveIntensity).toBe(0);
    lights.update(700, false);
    expect(emissiveOf(turn).emissiveIntensity).toBe(on);
    lights.update(400, true);
    expect(emissiveOf(turn).emissiveIntensity).toBe(on);
  });
});

describe("lamps on a real scene map", () => {
  it("the 4Runner controller discovers its lamps and survives a configuration replay", async () => {
    // A minimal root carrying the 4Runner scene map's DEFAULT_TAILLIGHTS brake region.
    const root = new THREE.Group();
    const taillights = new THREE.Group();
    taillights.name = "DEFAULT_TAILLIGHTS";
    const brakeMaterial = new THREE.MeshStandardMaterial({ name: "emissive.brakelights" });
    taillights.add(new THREE.Mesh(new THREE.BoxGeometry(), brakeMaterial));
    root.add(taillights);

    const controller = new VehicleSceneController(root, [], getSceneMapForVehicle("4runner"));
    expect(controller.lights.availableModes()).toContain("brake");
    controller.lights.setMode("brake");
    await controller.applyConfiguration({});
    const mesh = taillights.children[0] as THREE.Mesh;
    expect((mesh.material as THREE.MeshStandardMaterial).emissiveIntensity).toBeGreaterThan(1);
  });
});
