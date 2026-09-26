import * as THREE from "three";

/**
 * AR on iPhone and iPad through Apple Quick Look.
 *
 * Safari on iOS has no WebXR `immersive-ar` at all, so the WebXR path (`xrSession.ts`) reports
 * "unsupported" on the devices a large share of shoppers carry. Quick Look is iOS's native AR
 * viewer: it opens a USDZ file from an `<a rel="ar">` link and handles placement, scale and lighting
 * itself. The USDZ is exported on demand from the *current* build — the paint, wheels and
 * accessories the viewer configured — rather than shipping a static file per vehicle that could
 * only ever show the default spec. It is exported ahead of the tap (`VehicleCanvas`) and offered as a
 * real `<a rel="ar">` whose first child is an `<img>` (`BuilderApp`): Safari only hands a link to
 * Quick Look when the viewer's own gesture activates it, which an export started by the tap outlives.
 *
 * Exported from a detached clone so nothing in the live scene moves, at true scale (see
 * `arPlacement.ts`), resting on its own floor at the origin — Quick Look anchors the file's origin to
 * the detected plane.
 */

/** Whether this browser can open an `<a rel="ar">` in Quick Look (iOS/iPadOS Safari and WebViews). */
export function supportsQuickLook(doc: Document = document): boolean {
  const anchor = doc.createElement("a");
  return Boolean(anchor.relList?.supports?.("ar"));
}

/**
 * A detached, export-ready copy of the vehicle: only visible geometry, scaled by `scale`, centred on
 * the origin and standing on y = 0. Geometry and materials are shared with the live scene (clone
 * semantics), so this costs no GPU memory and must not be disposed.
 */
export function buildQuickLookRoot(root: THREE.Object3D, scale: number): THREE.Group {
  root.updateWorldMatrix(true, true);
  const copy = root.clone(true);
  // Drop what the viewer cannot see (hidden accessories, a stock rim a replacement displaced) so the
  // exporter never has to walk it.
  const hidden: THREE.Object3D[] = [];
  copy.traverse((object) => {
    if (!object.visible) hidden.push(object);
  });
  for (const object of hidden) object.removeFromParent();

  const holder = new THREE.Group();
  holder.name = "QUICK_LOOK_ROOT";
  copy.position.set(0, 0, 0);
  holder.add(copy);
  holder.scale.setScalar(scale);
  holder.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(holder);
  const center = bounds.getCenter(new THREE.Vector3());
  copy.position.set(-center.x / scale, -bounds.min.y / scale, -center.z / scale);
  holder.updateWorldMatrix(true, true);
  return holder;
}

/**
 * Exports the current build to a USDZ blob URL. The exporter lives in its own chunk (it is only ever
 * needed by an iOS viewer who taps AR), so it is imported here rather than at module top level.
 */
export async function exportQuickLookUrl(root: THREE.Object3D, scale: number): Promise<string> {
  const { USDZExporter } = await import("three/examples/jsm/exporters/USDZExporter.js");
  const exporter = new USDZExporter();
  const holder = buildQuickLookRoot(root, scale);
  const bytes = await exporter.parseAsync(holder, { quickLookCompatible: true, maxTextureSize: 1024 });
  return URL.createObjectURL(new Blob([bytes], { type: "model/vnd.usdz+zip" }));
}
