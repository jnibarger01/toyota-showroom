# Toyota 3D Showroom — Frontend/Backend Integration Guide

How a React control reaches the Three.js scene and the database, in this repository.

```
React control → configurationStore → VehicleSceneController → REST API → persisted configuration
```

Everything below is implemented on this branch. File references are real, and the node/material
names were read out of `public/models/modsnation_7416_assets_assembled.glb`, not invented.

---

## 1. Current Integration Architecture

### What was already here

| Concern | Location | State before this work |
|---|---|---|
| Vehicle catalog | `lib/data/vehicles/*.ts` | Solid. Typed, versioned, single source of truth. |
| Catalog API | `app/api/v1/vehicles/**` | Solid. `force-static`, ETagged, validated query params. |
| Static fixtures | `scripts/generate-static-api.ts` | Solid. Generates `/catalog/v1/*.json` for the Pages export. |
| Client SDK | `lib/api/client.ts` | Solid. Base-path normalization, in-memory caching. |
| 3D viewport | `app/components/VehicleCanvas.tsx` | **Disconnected.** |
| Controls | `app/components/BuilderApp.tsx` | **Disconnected.** |
| Persistence | `db/schema.ts` | **Unused.** Schema existed; nothing wrote to it. |

The catalog and API layers are good and were extended, not replaced. The break was between the
controls, the scene, and storage.

### The four concrete defects

**1. Selections were a local `useState` shape with no persistence.** `BuildState` (`{ paint, lift,
roofRack, lightBar, sliders, wheels }`) lived in `BuilderApp`, and both "Save" buttons called
`setSaved(true)` — a boolean. Nothing was ever written anywhere. `db/schema.ts` had a `builds`
table with a column per feature, so adding a category would have meant a migration.

**2. Options had no identity.** Paint was passed as a raw hex string (`build.paint === color.hex`).
Two colours sharing a hex would have been indistinguishable, and nothing could be validated
server-side, because a hex is not a catalog reference.

**3. Wheel selection was wired to nothing.** `Vehicle3DConfig.wheelVariants` drove a `scale`
applied to `refs.wheels`, which was always empty — `createAccessories(root, [])` was deliberately
called with no mounts. A code comment in `BuilderApp.tsx` acknowledged this and hid the control.

**4. Material updates were collected by name across a full traverse and mutated in place.**

```ts
// former VehicleCanvas.tsx
root.traverse((object) => {
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  for (const material of materials) {
    if (threeDConfig.paintableMaterialNames.includes(material.name)) paintMaterials.push(material);
  }
});
```

`GLTFLoader` deduplicates materials by glTF material index, so one instance is shared by every
primitive referencing it. This happened to be safe for `body.carmain` (only `BODY` uses it) but is
unsafe as a pattern: in this same asset `metal.chrome` is shared by six nodes and `tire.sidewall`
by five. Any future option using this code would have repainted all of them.

### Two defects found in the asset itself — since fixed at the source

Both were measured by parsing the GLB's JSON chunk and accessor bounds, not guessed, and both are
now fixed in the shipped GLB itself (`scripts/fix-donor-geometry.mjs`) rather than worked around at
runtime. This subsection keeps the original diagnosis for context; see that script's own header
comment for the fix, and "Fixing the donor geometry at the source" further down for how it was
verified.

**Donor geometry at the world origin.** Six nodes sat at the scene root with no transform and
geometry authored around the origin — `322-1790(MD010)`, `322-1790(MD010).001`,
`BFGoodrich_ALL_Terrain_TA_KO2`, `FRONT_BRAKES`, `REAR_BRAKES`, and `Jet Black`. The last was a
**radius-1 sphere** spanning y −1 → 1. All four `PLACED_AOOA_caliper_*` nodes were at the origin
too, rather than at their wheels.

**The vehicle floated.** Grounding used a `Box3` over the whole scene:

```ts
const box = new THREE.Box3().setFromObject(root);   // y: -1 → 1.82, because of the sphere
root.position.sub(center);
root.position.y += size.y / 2;                       // → y = 1.0
```

The tyres' lowest point is y 0.12, so the 4Runner hovered roughly 1.1 units above the grid.

Originally worked around by two data fields (`lib/data/vehicles/4runner.ts`) rather than a
heuristic — `hiddenNodeNames` (hid the six donor nodes and the four mispositioned calipers) and
`groundingNodeNames` (computed the bounding box from an explicit list instead of the whole scene).
`groundingNodeNames` is unchanged and still the more precise choice even now that the donor sphere
is gone entirely; `hiddenNodeNames` is gone — nothing left to hide.

### Fixing the donor geometry at the source (`scripts/fix-donor-geometry.mjs`)

No Blender is available in this environment, and there's no checked-in `.blend` source file
either — only the exported GLB. `scripts/fix-donor-geometry.mjs` is the closest achievable
equivalent: editing the shipped binary directly with `@gltf-transform/core`/`functions`, producing
the same *result* a Blender re-export and reupload would, verifiably.

Two fixes, both derived from data already present in the file — nothing guessed or invented:

1. **Reposition, don't hide, the four `PLACED_AOOA_caliper_*` nodes.** They shipped with no
   `translation` at all (defaulting to `BODY`'s own local origin), which is why they read as
   "mispositioned" rather than simply broken — they're real, intended geometry (the material names
   are literally `Red_wilwood`, `metal.chrome`, `Caliper_cover_logo`), just missing a transform.
   Every other per-wheel node (`PLACED_KO3_*`, `PLACED_WEISU_*`) already carries the correct
   translation for its wheel, matching `MOUNT_WHEEL_*`'s own — copying that exact vector onto the
   matching caliper node is precise, not an authoring guess.
2. **Delete the six true donor nodes** (`322-1790(MD010)`, `.001`, `BFGoodrich_ALL_Terrain_TA_KO2`,
   `FRONT_BRAKES`, `REAR_BRAKES`, `Jet Black`) and prune what becomes unreferenced. Verified before
   writing the script that every material these nodes use is also referenced **by index** from
   real, surviving geometry with *different* accessors (e.g. `PLACED_AOOA_caliper_front_left`'s
   mesh and `FRONT_BRAKES`'s mesh share the same four material indices but are distinct geometry) —
   so a `prune()` pass safely drops the truly-orphaned donor meshes/accessors (and the one material
   nothing else used, the "Jet Black" sphere's) while leaving every material a real node still
   references untouched. `gltf-transform`'s reachability analysis is what makes this safe to assert
   rather than hope; it isn't a heuristic guess about what "donor" means.

**A real near-miss, caught before it shipped.** The first run of `prune()` (without `keepLeaves:
true`) also deleted `MOUNT_WHEEL_*`, `MOUNT_LICENSE_PLATE_*`, and `MOUNT_SOUND_EXHAUST` — every
empty, mesh-less, child-less node the *glTF document itself* doesn't reference from anywhere else.
That describes real donor junk exactly as well as it describes load-bearing marker nodes
`VehicleCanvas.tsx`'s `installWheelAndTireAssets` and `lib/data/vehicles/4runner.ts`'s
`wheelMountNames` resolve **by name at runtime** — nothing inside the document points at them, so
pure glTF-graph reachability can't tell "empty transform used as an attachment point" from "empty
transform nobody needs." Caught by re-dumping the node list after the first run and noticing seven
nodes gone instead of the six actually named for deletion; fixed with `keepLeaves: true`, re-verified.

**Verification, not just a clean script exit:**
- `npm test` (`tests/glbContract.test.ts` and the rest) — 208/208, unaffected node names still
  resolve.
- `npm run build` + `npm run test:e2e` — all 5 Playwright tests green, including a full real-browser
  GLB load and the build-and-restore flow, against the *edited* file.
- The resulting node list dumped and read by hand: exactly the six donor names gone, the four
  calipers now carrying the same translation as their matching `PLACED_KO3_*` node, every
  `MOUNT_*` marker still present.
- File size: 56.9 MiB → 38.7 MiB (a ~32% reduction — donor geometry was a meaningful fraction of
  the payload; a welcome side effect for the base-GLB-size gap this repo already tracks, though not
  what this fix was for). §15 later compresses this file further, down to ~28.1 MiB.

Not fixed here, and not attempted: the calipers' local geometry/orientation itself (are they
authored to actually look correct once positioned?) wasn't visually re-verified beyond confirming
the scene loads and renders without errors — a full visual check needs either a real Blender
session or a much closer render inspection than this environment made practical to script
reliably. If they look wrong up close, that is 3D-authoring work this fix did not and could not do.

### Target architecture

```
app/components/BuilderApp.tsx          bootstrap + layout, owns no scene state
app/components/CustomizationButton.tsx the one control; calls selectOption and nothing else
app/components/VehicleCanvas.tsx       renderer/camera/loading; hands back a controller
        │
lib/state/configurationStore.ts        optimistic apply, batching, rollback
        ├── lib/three/sceneController.ts   the only writer to the scene graph
        │       ├── lib/three/nodes.ts       exact-name resolution + contract verification
        │       ├── lib/three/materials.ts   clone-on-write material writes
        │       └── lib/three/assets.ts      cached GLB loading, mounts, disposal
        └── lib/api/configurations.ts      the only fetch() for configurations
                └── app/api/v1/configurations/**  validation, revisions, canonical records
```

---

## 2. Customization and Persistence Schema

`lib/types/customization.ts`.

```ts
export type CustomizationCategory =
  | "paint" | "wheels" | "hood" | "panel" | "decal" | "trim" | "accessory" | "interior";

export interface CustomizationOption {
  id: string;
  category: CustomizationCategory;
  label: string;
  thumbnailUrl?: string;
  targetNodes?: string[];        // exact Object3D.name values
  targetMaterials?: string[];    // exact Material.name values — selects slots within a mesh
  operation: "material-update" | "mesh-visibility" | "mesh-replacement" | "texture-update";
  assetUrl?: string;             // server-resolved; never accepted from a client
  materialConfig?: MaterialConfig;
  hidesNodes?: string[];         // variants this option displaces
  mountNodes?: string[];         // attachment points for mesh replacement
  priceDelta?: number;
  compatibleVehicleIds: string[];
  compatibleGradeIds?: string[]; // absent ⇒ available on every grade
}
```

Two fields beyond the brief's shape earn their place: `hidesNodes` makes variant exclusion explicit
in data rather than implied by category, and `mountNodes` lets placement come from the asset's own
transform so re-authoring in Blender moves a part without a code change.

### Cardinality

Single-select by default; `accessory` and `decal` accumulate. Declared once and shared by the store
and the server, so both compute identical results:

```ts
export const MULTI_SELECT_CATEGORIES = ["accessory", "decal"] as const;
export const CATEGORY_APPLY_ORDER =
  ["trim","panel","hood","wheels","paint","interior","decal","accessory"] as const;
```

`interior` sits next to `paint` in the apply order — both are colour/material choices with no
dependency on any other category. It reuses the same `material-update` operation and
`SWATCH_CATEGORIES` swatch rendering as paint in `BuilderApp.tsx`; the only new thing it needed was
the category itself and a `Vehicle.threeDConfig.interiorMaterialNames` field naming the expected
seat material (`lib/data/vehicles/4runner.ts`). The 4Runner's GLB is exterior-only, so its two
interior options (`interior-fa20-black`, `interior-lf10-red` in `lib/data/options/4runner.ts`,
mirroring `interiorColors` exactly) are contract-gated like hood/decal — see "Known gaps" below.

### Persisted configuration

```ts
export interface VehicleConfiguration {
  configurationId: string;
  vehicleId: string;
  modelYear: number;
  model: string;
  gradeId: string;
  selections: Partial<Record<CustomizationCategory, string[]>>;
  cameraState?: CameraState;
  revision: number;          // server-owned; drives optimistic concurrency
  schemaVersion: string;
  createdAt: string;
  updatedAt: string;
}
```

Only stable ids are stored. No node name, material name, or GLB path is persisted, so re-authoring
the model never invalidates a saved build.

### Example

```json
{
  "configurationId": "cfg_9f2c41ab77e04d18b0c3",
  "vehicleId": "4runner",
  "modelYear": 2024,
  "model": "4Runner",
  "gradeId": "trd-pro",
  "selections": {
    "paint": ["paint-0r2-solar-octane"],
    "wheels": ["wheels-weisu-bronze"],
    "trim": ["trim-grille-blackout", "trim-tire-letters-raised-white"],
    "accessory": ["accessory-roof-rack", "accessory-rock-sliders"]
  },
  "cameraState": { "presetId": "hero", "position": [7.5, 4.0, 8.5], "target": [0, 1.1, 0] },
  "revision": 7,
  "schemaVersion": "1.0.0",
  "createdAt": "2026-08-03T18:41:02.113Z",
  "updatedAt": "2026-08-03T19:04:55.882Z"
}
```

> `trim` legitimately holds two ids: single-select cardinality applies per **selection group**, not
> per category. `trim-grille-blackout` is in group `trim-grille` and
> `trim-tire-letters-raised-white` in `trim-tire-letters`, so they coexist — but two grilles would
> be rejected with 422. See §5.

### Database

`db/schema.ts` defines `configurations` and an append-only `configuration_revisions`. `selections` is
a JSON column, so a new category is a catalog edit rather than a migration. The prototype's original
`builds`/`camera_presets` tables (one column per feature) were removed outright once confirmed
unreferenced anywhere in the codebase — this schema has never been deployed to a real database, so
there was no data to migrate away from, only a design to leave behind.

---

## 3. GLB Node and Material Naming Contract

### What the asset actually contains

`Khronos glTF Blender I/O v5.2.39` · 32 nodes · 25 meshes · 37 materials · Draco + clearcoat,
emissive-strength, specular, and IOR extensions.

```
BODY                          [10 materials: body.carmain, metal.chrome.004, glass.windows, …]
├── DEFAULT_HEADLIGHTS        [glass.light, plastik.all, metal.chrome.001, emissive.headlight, …]
├── DEFAULT_TAILLIGHTS        [emissive.brakelights, glass.light.001, emissive.taillight, …]
├── EXHAUST                   [metal.exhaust]
├── LOGO                      [plastik.all.001, metal.chrome.002]
├── Tun_GRILLE                [plastik.all.003]
├── MOUNT_WHEEL_FRONT_LEFT    (empty transform node, t = [0.834, 0.395, 1.527])
├── MOUNT_WHEEL_FRONT_RIGHT / REAR_LEFT / REAR_RIGHT
├── MOUNT_LICENSE_PLATE_FRONT / REAR, MOUNT_SOUND_EXHAUST
├── PLACED_KO3_front_left …   [tire.sidewall]        ← the visible tyres
├── PLACED_WEISU_front_left … [wheel.metal | wheel.metal.001]  ← the visible wheels
└── PLACED_AOOA_caliper_*     [paint_brake_caliper, metal.chrome, …]  ← at origin (defect)
322-1790(MD010), BFGoodrich_ALL_Terrain_TA_KO2, FRONT_BRAKES, REAR_BRAKES, Jet Black  ← donors
```

Three facts drive every design decision downstream:

1. **`BODY` is a single mesh with a ten-element material array.** Paint must address the
   `body.carmain` *slot*, not the mesh.
2. **`MOUNT_WHEEL_*` are empty transform nodes, and the wheels are their *siblings*.** This is why
   `wheelMountNames` resolved fine while `refs.wheels` stayed empty. Mounts are the correct
   attachment points for replacements; the `PLACED_*` nodes are what you recolour or hide.
3. **Materials are shared across nodes.** `wheel.metal` → front pair *and* the donor;
   `tire.sidewall` → all four tyres *and* the donor tyre; `metal.chrome` → six nodes.

### Convention for new exports

| Prefix | Meaning | Operation |
|---|---|---|
| `BODY_*` | Paintable shell | `material-update` |
| `HOOD_STOCK` / `HOOD_SPORT` | Mutually exclusive variants | `mesh-visibility` + `hidesNodes` |
| `PANEL_*` | Swappable panels | `mesh-visibility` or `mesh-replacement` |
| `WHEEL_FL/FR/RL/RR` | Wheel geometry | `material-update` or `mesh-replacement` |
| `MOUNT_*` | Empty transform node, attachment point | target of `mountNodes` |
| `DECAL_DRIVER` / `DECAL_PASSENGER` | Flat UV-mapped decal receivers | `texture-update` |
| `TRIM_*` | Grille, badging, bright work | `material-update` |
| `ACCESSORY_*` | Bolt-on parts | `mesh-visibility` or `mesh-replacement` |

Rules: exact names only; `SCREAMING_SNAKE_CASE` for nodes; never rename a node without a catalog
migration; keep authored material names stable (`body.carmain` is the contract, not "the first
material"). Never let a name be positional (`Mesh_003`).

The existing asset does not follow this scheme. It does not need to: the catalog names whatever the
asset actually calls things. The convention applies to *new* exports, and the hood/decal/panel
options in the catalog are written against it in advance.

### How a record maps to the scene

| Field | Resolves to | API |
|---|---|---|
| `targetNodes` | `Object3D.name` | `root.getObjectByName(name)` |
| `targetNodes` on a group | every descendant mesh | `object.traverse` |
| `targetMaterials` | slot within `mesh.material[]` | filter by `material.name` |
| `mountNodes` | empty transform node | `mount.add(clone)` |
| `hidesNodes` | displaced variant | `node.visible = false` |
| `assetUrl` | cached replacement GLB | `loadAsset(url)` |

Nothing consults a child index or traversal position. A test asserts this by reversing
`BODY.children` and re-resolving — same object comes back (`tests/mapping.test.ts`).

### Hierarchy dump utility

`logHierarchy` in `lib/three/nodes.ts`, exposed in dev builds:

```js
window.__dumpVehicleHierarchy()
```

```ts
export function logHierarchy(root: THREE.Object3D): void {
  root.traverse((object) => {
    console.log({
      name: object.name,
      type: object.type,
      visible: object.visible,
      material:
        object instanceof THREE.Mesh
          ? Array.isArray(object.material)
            ? object.material.map((material) => material.name)
            : object.material?.name
          : undefined,
    });
  });
}
```

For offline inspection, parse the GLB's JSON chunk directly — no decode, no browser, and it reads
accessor `min`/`max` so you can detect misplaced geometry:

```js
const buf = readFileSync(path);
let off = 12, json;
while (off < buf.length) {
  const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
  if (type === 0x4e4f534a) { json = JSON.parse(buf.slice(off + 8, off + 8 + len).toString()); break; }
  off += 12 + len + ((4 - (len % 4)) % 4);
}
```

### The contract is also verified in CI, not only in the browser

`tests/glbContract.test.ts` parses the real, checked-in GLB via `lib/tooling/glbInspect.ts` — a
dependency-free binary-chunk reader, no three.js/DOM needed — and re-derives the same pass/fail
`verifyNodeContract` would produce at runtime, for every option in every vehicle's catalog. A typo'd
node name, a renamed material, or a swapped asset now fails the build instead of surfacing only as a
console warning the first time someone loads the page.

Options that are genuinely forward-declared (see below) are named in `KNOWN_GATED_OPTION_IDS`; the
test asserts they *stay* unresolved, so the allowlist itself goes stale — and gets caught — the
moment an asset delivery quietly makes one of them resolvable.

### The contract is verified at load, not at click

`verifyNodeContract(root, catalog)` checks every option's nodes and materials against the loaded
GLB and splits the catalog in two. Unsatisfied options are logged with their ids and **never
rendered**, so a missing node can't reach the user as a dead button:

```
[customization] option "hood-sport-scoop" is unavailable for this asset.
  { missingNodes: ["HOOD_SPORT", "HOOD_STOCK"], missingMaterials: [] }
```

This is what lets the catalog carry forward-declared hood, panel, and decal options today: they
activate the day the re-export lands, with no code change.

---

## 4. React Button-to-State-to-API Wiring

### The control

`app/components/CustomizationButton.tsx` — its entire behaviour is one call.

```tsx
export function CustomizationButton({ option, variant = "chip" }: Props) {
  const { configuration, pending } = useConfiguration();
  const selected = (configuration?.selections[option.category] ?? []).includes(option.id);
  const busy = pending.has(option.id);

  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`option-chip ${selected ? "active" : ""}`}
      disabled={busy}
      onClick={() => void configurationStore.selectOption(option)}
    >
      <span>{option.label}</span>
      {option.priceDelta ? <small>+${option.priceDelta.toLocaleString()}</small> : null}
      {busy ? <Loader2 size={13} className="spin" /> : selected ? <Check size={13} /> : null}
    </button>
  );
}
```

It doesn't know which of the four operations the option performs. Adding an option is a data change.

### The action

`lib/state/configurationStore.ts`. State and scene move synchronously so the viewport responds on
the click's own frame; only then is the write queued.

```ts
async selectOption(option: CustomizationOption): Promise<void> {
  const current = this.state.configuration;
  if (!current) return;

  const alreadyOn = isSelected(current.selections, option);
  const selections = alreadyOn
    ? withOptionDeselected(current.selections, option)
    : withOptionSelected(current.selections, option);

  if (alreadyOn && !isMultiSelect(option.category)) return;   // no redundant round trip

  const next = { ...current, selections, updatedAt: new Date().toISOString() };

  this.setState({ configuration: next, pending: new Set(this.state.pending).add(option.id), status: "saving", error: null });
  this.batchedOptionIds.add(option.id);

  await this.applyToScene(option, !alreadyOn);
  this.queueFlush();
}
```

If the scene cannot honour the selection, that is a failure, not a no-op:

```ts
const ok = enable ? await controller.applyOption(option) : await controller.removeOption(option);
if (!ok) await this.rollback(`"${option.label}" could not be applied to the model.`);
```

### Batching

`queueFlush` debounces 400 ms and `flush` sends one PATCH for the batch, so dragging across a
colour row is a single write carrying the final state. A `pagehide` listener flushes on tab close.

```ts
async flush(): Promise<void> {
  const configuration = this.state.configuration;
  if (!configuration) return;
  const batched = [...this.batchedOptionIds];
  this.batchedOptionIds.clear();

  try {
    const saved = await configurationsApi.updateConfiguration(configuration.configurationId, {
      selections: configuration.selections,
      cameraState: configuration.cameraState,
      expectedRevision: this.lastPersisted?.revision,
    });
    this.lastPersisted = saved;
    this.setState({ configuration: saved, status: "saved", error: null, pending: withoutIds(this.state.pending, batched) });
  } catch (error) {
    await this.rollback(error instanceof Error ? error.message : String(error), batched);
  }
}
```

The server's record is adopted wholesale — it owns `revision`, timestamps, and normalization.

### Rollback

Rollback replays the last server-confirmed configuration rather than inverting the failed call.
Inversion is wrong for mesh replacement, where "undo" isn't the opposite of the last operation.

```ts
private async rollback(message: string, batched: string[] = []): Promise<void> {
  const restored = this.lastPersisted;
  this.setState({
    configuration: restored ?? this.state.configuration,
    status: "error",
    error: message,
    pending: withoutIds(this.state.pending, batched.length ? batched : [...this.state.pending]),
  });
  // Awaited, not fired and forgotten: the user must not see the rejected selection still applied
  // after the store has reported the failure.
  if (restored && this.controller) await this.controller.applyConfiguration(restored.selections);
}
```

`lastPersisted` is the last state the *server* confirmed, so a failed write undoes the whole batch,
not just the final click.

### Loading and error states

`status` is `idle | saving | saved | error`. `pending` is a `Set` of option ids, so a control shows
its own spinner rather than the panel disabling wholesale. The error banner is dismissible and
reports the server's message verbatim (e.g. `Option "paint-0r2-solar-octane" is not available on
grade "sr5".`).

### Why not Zustand

React 19 ships `useSyncExternalStore`; the store is ~60 lines and needs no dependency. No component
reaches past `selectOption` / `flush` / `attachScene`, so swapping in Zustand's `create()` over the
same actions is like-for-like.

### Grade switching

`app/components/BuilderApp.tsx`'s `changeGrade`. `gradeId` is immutable on a persisted
configuration — the server only accepts it at `POST /api/v1/configurations`, never on `PATCH` (§5)
— so switching grades creates a new configuration rather than editing the current one, the same
pattern `reset()` already used.

This has to run without reloading the GLB, so the bootstrap effect fetches the vehicle's full,
*ungraded* catalog (`listVehicleOptions(vehicleSlug)`, no `gradeId`) and hands it to `VehicleCanvas`.
`verifyNodeContract` therefore resolves every option the model can satisfy across every grade in one
pass, and the `VehicleSceneController` it constructs holds that same full set internally — grade
membership is never encoded into the controller or the loaded scene, only into which options the
store exposes to the UI at a given moment. `handleSceneReady` keeps a ref to this full, verified list
(`fullApplicableRef`) precisely so `changeGrade` can re-filter it by `isOptionAvailableForGrade`
without touching Three.js at all:

```ts
const forGrade = fullApplicableRef.current.filter((option) => isOptionAvailableForGrade(option, gradeId));
```

Selections that don't survive that filter (a TRD Pro-only paint, a Limited-only interior) are
dropped before the new configuration is created — carrying them forward would either be rejected by
server validation (§5, "What validation enforces") or, worse, accepted and shown on a grade that
doesn't actually offer it. `configurationStore.attachScene(controller, fresh, forGrade)` then calls
`controller.applyConfiguration(fresh.selections)`, which resets every writable slot on the live scene
before replaying what survived — so a dropped selection can never linger visually after the grade
that justified it is gone.

### Vehicle lineup (`app/explore/page.tsx`)

The browse/lineup page a parallel work stream had already laid the groundwork for:
`lib/types/vehicle.ts`'s `VehicleSummary`/`toVehicleSummary`/`VehicleQueryFacts`, `lib/api/query.ts`'s
`matchesFilters`/`paginateAndFilter`/`queryVehicles`, and `lib/api/client.ts`'s `listVehicles` were all
present, tested indirectly through `GET /api/v1/vehicles` (`app/api/v1/vehicles/route.ts`), but nothing
in `app/` rendered them. `app/explore/page.tsx` is that consumer: a client component that fetches the
full catalog once (`listVehicles({}, { page: 1, pageSize: MAX_PAGE_SIZE })`) into local state, then
filters client-side with the same `matchesFilters` the server uses for its own filtering — so a
body-style chip and a `?bodyStyle=` query parameter can never disagree about what counts as a match.
Each card links to `pageUrl(slug)` (new export in `lib/api/client.ts`), which prefixes the vehicle's
own `/[slug]/` route the same way every other asset URL in this SDK is prefixed — required for the
link to resolve once GitHub Pages serves the site under `/toyota-showroom/`. `BuilderApp.tsx`'s
previously inert "Explore" nav button now navigates here.

`/` and `/[slug]` are unchanged — this is an additive route, not a redesign of the existing ones.

**Pagination (Task 26, added later).** The full-catalog fetch above is unchanged — still needed so
the body-style chips show every style regardless of the current page — but the rendered grid no
longer maps over the entire filtered result. A second, independent `paginateAndFilter(filtered, {},
{ page, pageSize: DEFAULT_PAGE_SIZE })` pass (its own filter argument is `{}`, a no-op; only the
page math is used) slices the current page out client-side, with Previous/Next controls that only
render when `totalPages > 1`. Switching the body-style filter resets to page 1 — done during render
(comparing `bodyStyle` against a `prevBodyStyle` state value, React's own documented pattern for
"adjusting state when a prop changes"), not in a `useEffect`, which
`eslint-plugin-react-hooks`'s `set-state-in-effect` rule (the same rule this section's "Vehicle
comparison" note and §13's compare-page hydration fix both already reference) correctly flagged
when first written that way — an effect here would commit the stale page once, then commit again
to fix it. With the real production catalog (3 vehicles, well
under `DEFAULT_PAGE_SIZE`) this is invisible in normal use, same as before — `tests/components/
ExplorePage.test.tsx` ships its own 14-vehicle fixture specifically to exercise the controls the
real catalog can't yet, verified with a deliberate-bug check (reverting the wiring correctly fails
all three of that file's tests) and confirmed not to change anything about the real 3-vehicle build
via the full Playwright suite, including `visual.spec.ts`'s `/explore` screenshot.

### Vehicle comparison (`app/compare/page.tsx`)

Also built on groundwork that predates this task: `lib/api/client.ts`'s `compareVehicles(slugs)`
(2–4 slugs, now exported as `MIN_COMPARE`/`MAX_COMPARE`) fetches each vehicle's full record in
parallel and was already validated, just never called from a page. `app/explore/page.tsx` gained a
per-card "Compare" checkbox and a sticky bar that appears once 2+ are picked, linking to
`/compare?vehicles=<slug>,<slug>,...`.

`app/compare/page.tsx` reads that query string exactly once via a `useState` lazy initializer
(`typeof window === "undefined" ? [] : ...`) rather than an effect — the value is this component's
own editable `picked` state from the first render on, not something an effect needs to keep
synchronized with an external source. Every subsequent recomputation (`validSlugs`, the fetch
effect, the comparison table) derives from `picked`, so checking or unchecking a box in the page's
own vehicle picker updates the table live, without needing the "Update comparison" link — that link
exists to make the current selection shareable/bookmarkable via a real URL, not to trigger the
comparison itself. The fetch effect never calls `setState` synchronously in its own body (an early
`setVehicles(null)` guard would trip `react-hooks/set-state-in-effect`, the same rule
`app/[slug]/page.tsx`'s `key={slug}` remount was chosen to satisfy back in Task 18); instead a
derived `canCompare` boolean gates which effect branch runs and which JSX renders, so there is
nothing to synchronize when the selection drops below `MIN_COMPARE`.

The comparison table's spec rows are the **union** of every compared vehicle's `Vehicle.specs[]`
entries, keyed by `SpecEntry.key` and grouped by `SpecEntry.category` — 4Runner, Tacoma, and Camry
each define an overlapping but not identical set of keys (all three have `zero_to_60_sec`; only
Tacoma has `max_towing_lbs`; only Camry has `hybrid_battery_warranty_years_miles`), so a naive
per-vehicle listing would misalign rows. A vehicle missing a given key renders `—` in that column
rather than the row being dropped.

### Share configuration (`lib/showroom/buildTools.ts`)

Landed as part of the parallel work stream this branch merged (§11's "Known gaps" documents the
merge itself); recorded here because it was still undocumented and untested against a real backend
at the time.

`BuilderApp.tsx`'s `share()` builds a URL from `createConfigurationShareUrl(origin, pathname,
configurationId)` — `#configuration=<id>`, not a query parameter, so the fragment never reaches the
server and can't be logged or leaked by a proxy — and copies it via `navigator.clipboard`, falling
back to `window.prompt` when the Clipboard API is unavailable (an insecure context, or a browser
without permission granted). `pathname` is read from `window.location` at share time, which already
includes the vehicle's own route segment (`/4runner/`), so the link opens back on the right vehicle's
builder rather than the default one.

On load, `safeReadStoredId` checks `readSharedConfigurationId(window.location.hash)` **before**
falling back to this browser's own remembered configuration id for that vehicle
(`storageKeyFor(vehicleSlug)`) — a shared link always wins over whatever the visitor was last
working on. `readSharedConfigurationId` validates the id against `/^[a-zA-Z0-9_-]+$/` before
returning it, so a malformed or path-traversal-shaped fragment (`#configuration=../../bad`, tested
in `tests/buildTools.test.ts`) is rejected rather than handed to `getConfiguration`.

Reading a configuration by id has never required the owner token (§5's "Ownership" — only
`PATCH`/`DELETE` do), so a shared link is inherently a read-only capability: opening one lets a
visitor view and then freely re-customize the build in their own session, but never overwrites the
original unless they also hold its owner token.

### Component tests (`tests/components/*.test.tsx`)

Every prior test in this project imports plain library modules under Node — none render a
component, because none needed to. `CustomizationButton.tsx` and `BuilderApp.tsx` do, so this
required real infrastructure: `@testing-library/react` + `@testing-library/jest-dom`, and jsdom as
a DOM. Rather than switch the whole suite to jsdom (slower, and pointless for the ~175 tests that
never touch a DOM), `vitest.config.ts`'s `environmentMatchGlobs` scopes jsdom to
`tests/components/**/*.test.tsx` only — everything else keeps running under plain Node.

Two things had to be worked out to get a single component rendering at all, both recorded as
comments in `vitest.config.ts` so they aren't rediscovered the hard way again:

- **"React is not defined."** Vitest's own module runner transforms `.tsx` via esbuild directly,
  ahead of any Vite plugin pipeline — `esbuild`'s default JSX transform is classic
  (`React.createElement`, no auto-import) unless told otherwise. Fixed with
  `esbuild: { jsx: "automatic", jsxImportSource: "react" }` in the vitest config. Adding
  `@vitejs/plugin-react` on top achieves nothing at runtime (esbuild already owns the transform)
  and breaks `tsc`: its `Plugin` type resolves against this repo's root `vite` (rolldown-vite 8.x),
  while `vitest/config`'s `PluginOption` resolves against Vitest's own bundled, older, plain
  `vite` (7.x) — two nominally distinct `Plugin` types for the same runtime behavior. Left out.

`CustomizationButton.test.tsx` drives the real `configurationStore` singleton (`attachScene` with a
duck-typed fake `VehicleSceneController` — `applyOption`/`removeOption`/`applyConfiguration` always
succeed, so the test asserts the button's own rendering and click-dispatch behavior, not scene
node-resolution, which `tests/sceneController.test.ts` already owns) and mocks only
`lib/api/configurations` (the network boundary) — clicking a chip is a real `selectOption` call
through the real store, asserted by the resulting DOM (`aria-pressed`, `disabled`, `.active`).

`BuilderApp.test.tsx` mocks `VehicleCanvas` (jsdom cannot run WebGPU/WebGL) with a stub that
immediately calls `onReady` with a fake controller and the full real `fourRunnerOptions` catalog,
and mocks `lib/api/client`/`lib/api/configurations`, but otherwise renders the real component tree
against real catalog and vehicle data (`lib/data/vehicles/4runner.ts`). It covers the loading
state, bootstrap rendering, and — closing the gap called out in Task 6's own commit — the grade
selector: switching grades creates a new configuration and **drops a grade-incompatible selection**
(asserted by selecting `paint-0r2-solar-octane`, a TRD Pro-only option, switching to `sr5`, and
checking it's gone from `configurationStore`'s selections). Verified with the deliberate-bug
technique used elsewhere in this project: reverting the `changeGrade` filter to keep every
selection regardless of grade compatibility turns that assertion red, confirming the test would
actually catch the regression it exists to prevent.

Writing these also surfaced a real, pre-existing UI inconsistency worth recording: the left rail's
"Systems" buttons (added by the same parallel work stream as the single-category redesign) don't
all map to the category their label implies — "Lighting" is the button that actually switches to
the `accessory` category (roof rack, light bar, rock sliders); "Accessories" switches to `decal`.
`BuilderApp.test.tsx` documents this with a comment at its one point of contact rather than silently
using the mismatched label. Not fixed here — it's the other stream's UI design, not a regression
this task introduced, and relabeling it without knowing that stream's intent risks guessing wrong.

### Visual regression testing (`tests/e2e/visual.spec.ts`)

Pixel-diff testing with real Playwright, against the real static export — `playwright.config.ts`'s
`webServer` runs `scripts/preview-server.mjs`, a small `node:http` server written for this because
nothing else in the toolchain serves `dist/client` at the sub-path GitHub Pages actually serves it
at (`/toyota-showroom/`, `vite.config.ts`'s `base`). Serving it at the domain root instead — what a
plain `http-server`/`serve` invocation does — 404s every stylesheet and catalog fixture, since every
asset URL the app emits is already prefixed for that sub-path. `vinext dev` was not an option
either: its startup `Request.cf` fetch has no network route in this sandbox and it never boots a
single route as a result — "Build-and-restore E2E test" below hits the same wall for the same
reason, and reuses this same server.

Scope is deliberately DOM/CSS pages only — `/explore`, `/compare`, and the builder's UI chrome with
its `.vehicle-canvas` element masked out of the diff. The builder's actual 3D content is not
pixel-tested: camera float precision, GPU vs. software rasterization, and antialiasing differ
enough between machines that diffing the live WebGPU/WebGL canvas would be flaky by construction,
not a real regression signal. `SCREENSHOT_OPTIONS.maxDiffPixelRatio` is `0.02`, not `0` — even
same-OS, a different Chromium *build* hints fonts a few pixels differently, and zero-tolerance
diffing would fail this suite for reasons that have nothing to do with an actual regression.

**A real, disclosed risk in the committed baselines.** They were generated in a sandboxed
environment whose outbound network is proxied and blocks `cdn.playwright.dev`, so
`npx playwright install` cannot fetch the Chromium build `@playwright/test`'s installed version
actually expects; the environment has a different, pre-installed Chromium (a build ~40 revisions
older) at a fixed path, and `playwright.config.ts`'s `launchOptions.executablePath` points at it
*only when that path exists* — real CI (`.github/workflows/e2e.yml`) has no such path and instead
runs `npx playwright install --with-deps chromium` for a browser matching its own resolution. If
that CI browser renders meaningfully differently from the sandbox's older one, the very first CI
run of this workflow may fail on a difference that reflects the browser build, not a real
regression. The fix, if that happens, is exactly what it would be for any future legitimate visual
change: `npm run test:e2e:update` (after `npm run build`) and commit the regenerated PNGs under
`tests/e2e/visual.spec.ts-snapshots/` — ideally run once, in CI itself or an environment with real
Playwright browser access, rather than assumed away.

### Build-and-restore E2E test (`tests/e2e/build-and-restore.spec.ts`)

The actual product promise the whole persistence layer (§5, §7) exists for, checked end to end
against a real browser instead of assumed from unit coverage: select an option, reload the tab, get
the same build back. Runs the same way the visual tests do — real static export, real
`scripts/preview-server.mjs` — with no backend present, so it exercises exactly what a real GitHub
Pages visitor gets: `lib/api/configurations.ts` detects there's no request-aware backend and falls
back to `localConfigurationTransport` (browser `localStorage`), same as §5's "Deployment note".

Two tests, each a real GLB load (`public/models/modsnation_7416_assets_assembled.glb`, ~39 MiB) —
not mocked, unlike `tests/components/BuilderApp.test.tsx`'s stubbed `VehicleCanvas`, because the
whole point here is proving the real scene restores a real selection, not just that
`configurationStore`'s state does:

1. Select a paint color, wait for the debounced save to clear ("Saving" disappearing), reload,
   confirm the same swatch is still `aria-pressed`.
2. Select an accessory the same way, but also change lift height first. Lift height does **not**
   survive the reload — this was the actual, correct discovery while writing this test, not a bug:
   `lift` is plain `useState(2)` in `BuilderApp.tsx`, not a field in `VehicleConfiguration`
   (`lib/types/customization.ts`) at all, so it's a page-local ride-height preview rather than a
   saved customization. The test asserts that real behavior (lift resets to `2"` on reload)
   instead of the wrong assumption it started from.

Both tests run `test.describe.configure({ mode: "serial" })`, and `playwright.config.ts` caps
`workers` to `1` in CI specifically: two Chromium instances each loading a 39 MiB GLB at once was
enough resource contention in the sandbox this was built in to make the second one time out for
reasons that had nothing to do with the app — GitHub Actions' standard runners are similarly
modest (2-core). Verified with the deliberate-bug technique used throughout this project: forcing
`safeReadStoredId` to always return `null` (simulating a browser that never finds its own stored
configuration id) turns the paint-restoration test red, confirming it actually catches that class
of regression, then reverted.

---

## 5. Backend Endpoint Design

| Method | Path | Runtime | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/vehicles/:vehicleId/options` | static | Catalog for one vehicle, optionally grade-filtered |
| `POST` | `/api/v1/configurations` | dynamic | Create |
| `GET` | `/api/v1/configurations/:configurationId` | dynamic | Read |
| `PATCH` | `/api/v1/configurations/:configurationId` | dynamic | Update |
| `DELETE` | `/api/v1/configurations/:configurationId` | dynamic | Delete |

### `GET /api/v1/vehicles/4runner/options?gradeId=trd-pro`

```json
{
  "schemaVersion": "1.0.0",
  "vehicleId": "4runner",
  "gradeId": "trd-pro",
  "data": [
    {
      "id": "paint-0r2-solar-octane",
      "category": "paint",
      "label": "Solar Octane",
      "operation": "material-update",
      "targetNodes": ["BODY"],
      "targetMaterials": ["body.carmain"],
      "materialConfig": { "color": "#ff6a1a", "metalness": 0.65, "roughness": 0.28, "clearcoat": 1, "clearcoatRoughness": 0.06 },
      "priceDelta": 425,
      "compatibleVehicleIds": ["4runner"],
      "compatibleGradeIds": ["trd-pro"]
    }
  ]
}
```

This is the **only** direction node names, material names, and asset URLs travel. They are never
accepted inbound.

### Ownership: who may PATCH or DELETE a configuration

Until this was added, knowing a `configurationId` — leaked through a shared URL, browser history, a
referrer header — was sufficient to overwrite or delete someone else's saved build; there was no
notion of who created a record. There is no user-account system to authenticate against, so
`lib/shared/ownerToken.ts` implements the minimum that actually closes the gap: a per-configuration
capability token, not a login.

`POST` mints a random 256-bit token, stores only its SHA-256 hash (`configurations.owner_token_hash`
in `db/schema.ts`), and returns the plaintext exactly once, in the create response. Every `PATCH`/
`DELETE` must present it via `X-Owner-Token`; the repository hashes what it receives and compares
with a constant-time check before touching the record. `GET` takes no token and stays open — that's
what the sharing feature (Task 5) depends on.

The client SDK (`lib/api/configurations.ts`) handles this transparently: `createConfiguration`
remembers the token it receives (localStorage, keyed by `configurationId`); `updateConfiguration`/
`deleteConfiguration` attach it automatically. `configurationStore.ts` and `BuilderApp.tsx` call
these exactly as before and need no awareness that writes are now authenticated at all. The
browser-local fallback transport (`localConfigurationTransport.ts`, used on the static export)
enforces the identical check against its own storage, for consistency — even though a same-origin
tab is already its own isolation boundary there.

Deliberately per-configuration rather than per-device: a leaked token compromises one saved build,
not everything a browser has ever created, and there is no separate provisioning step — `create` and
"receive an owner token" are the same call.

### `POST /api/v1/configurations`

```json
{ "vehicleId": "4runner", "modelYear": 2024, "gradeId": "trd-pro",
  "selections": { "paint": ["paint-0r2-solar-octane"] } }
```

`201 Created`, `Location: /api/v1/configurations/cfg_…`:

```json
{
  "schemaVersion": "1.0.0",
  "data": { "configurationId": "cfg_9f2c41ab77e04d18b0c3", "vehicleId": "4runner", "modelYear": 2024,
            "model": "4Runner", "gradeId": "trd-pro",
            "selections": { "paint": ["paint-0r2-solar-octane"] },
            "revision": 1, "schemaVersion": "1.0.0",
            "createdAt": "2026-08-03T18:41:02.113Z", "updatedAt": "2026-08-03T18:41:02.113Z" },
  "ownerToken": "k7QpX...redacted...9fZ",
  "pricing": { "optionsTotal": 425 }
}
```

`model` is stamped from the catalog, not the request. `optionsTotal` is summed from catalog
`priceDelta` values, never from client figures. `ownerToken` is the **only** response that ever
carries the plaintext — it is not returned by `GET`, and a lost token has no recovery path short of
creating a new configuration.

### `PATCH /api/v1/configurations/:configurationId`

```
X-Owner-Token: k7QpX...redacted...9fZ
```
```json
{ "selections": { "paint": ["paint-1j9-ice-cap"], "accessory": ["accessory-roof-rack"] },
  "expectedRevision": 1 }
```

Returns the full canonical record at `revision: 2`. A stale `expectedRevision` yields `409`; a
missing or non-matching `X-Owner-Token` yields `403` — checked *after* existence, so a wrong token
against an unknown id still reports `404`, not `403` (avoids using the ownership check to confirm
whether an id exists at all).

### Errors

Every non-2xx body matches `ApiErrorBody` (`lib/api/errors.ts`):

```json
{ "error": { "code": "invalid_body", "status": 422,
             "message": "Option \"paint-0r2-solar-octane\" is not available on grade \"sr5\"." } }
```

| Status | Code | Cause |
|---|---|---|
| 400 | `invalid_query` | Bad query parameter |
| 403 | `forbidden` | Missing or non-matching `X-Owner-Token` on a PATCH/DELETE |
| 404 | `not_found` | Unknown vehicle or configuration |
| 409 | `revision_conflict` | Stale `expectedRevision` |
| 422 | `invalid_body` | Unknown option, wrong category, bad grade/year, cardinality violation |
| 429 | `rate_limited` | More than 30 writes/minute from one client IP (POST/PATCH/DELETE only; `Retry-After: 60` header set) |

### What validation enforces

`lib/validation/configuration.ts`:

- **Model year** is checked against the catalog record, not accepted as given — a 2019 TRD Pro is
  rejected even when well-formed.
- **Grade** must exist on that vehicle; the error lists the valid ids.
- **Option ids** must exist in *that vehicle's* catalog, sit in the category they claim, and be
  offered on the grade.
- **Cardinality** — enforced per `selectionGroup` (defaulting to the category), so `trim` may hold
  one grille *and* one tyre-lettering choice but never two grilles; duplicates rejected.
- **A PATCH re-validates against the stored record**, never the request's own claims. A client
  holding an SR5 configuration cannot unlock a TRD Pro colour by restating its grade. This is
  covered by a test.
- **Camera vectors** must be three finite numbers.

`resolveOptions(vehicleId, selections)` is the trust boundary: ids in, catalog-owned records out.

### Persistence

Handlers depend on `ConfigurationRepository`, never on Drizzle directly, so the same handlers run
against D1 in the Worker and the in-memory store in dev and tests. Revision bumping and history
appending live in the repository, so no caller can write without recording a revision.

`lib/server/d1ConfigurationRepository.ts` is the real D1 implementation, bound automatically —
`instrumentation.ts`'s `register()` runs once per Worker isolate (vinext emits it as a top-level
`await` in the generated App Router entry), tries `import("cloudflare:workers")` for `env.DB`, and
calls `setConfigurationRepository(new D1ConfigurationRepository(env.DB))` only when that binding
resolves. Everywhere else — `npm run dev`, `vitest`, static prerendering — the import fails or the
binding is absent, `register()` returns early, and `InMemoryConfigurationRepository` (the default)
stays active; no environment sniffing at any call site. `cloudflare:workers` is externalized in
`vite.config.ts`'s `build.rolldownOptions` — Rolldown doesn't auto-externalize `cloudflare:`-prefixed
specifiers the way it does `node:`-prefixed ones, and without that the build fails outright rather
than deferring the import to runtime.

D1 has no interactive multi-round-trip transactions; its real atomicity primitive is
`db.batch([...])`, an all-or-nothing group of prepared statements. Every write touching both
`configurations` and `configuration_revisions` goes through one batch call. The preceding read (to
decide 404 vs. 403 vs. 409) is a separate statement — a real, accepted narrowing versus full ACID,
closed as far as practical by re-checking `revision` in the update's own `WHERE` clause and treating
zero affected rows as a concurrent-write conflict, but not eliminated. Verified against a real local
D1 instance — no Cloudflare account needed; `wrangler d1 migrations apply --local` and `wrangler`'s
`getPlatformProxy()` both work fully offline — in `tests/d1ConfigurationRepository.test.ts`, not just
typechecked against `@cloudflare/workers-types`.

### Deployment note

`output: "export"` cannot serve `force-dynamic` routes, so the GitHub Pages build has no
configuration API. Rather than ship a demo where saving is broken, `lib/api/configurations.ts`
latches to a browser-local transport when a *write* fails in a way only a host without the route
can fail (network error, 405, or 404 on POST/PATCH). A 404 on GET is passed through, because
against a live API that means the configuration genuinely doesn't exist.

The fallback runs **the same validators** as the server, so behaviour is identical; only durability
differs. The Cloudflare Worker build (already configured via `@cloudflare/vite-plugin`) serves the
real API.

---

## 6. Three.js Material, Texture, Visibility, and Mesh-Swap Functions

### Locating nodes

```ts
export function resolveNodes(root: THREE.Object3D, names: readonly string[]): NodeLookupResult {
  const found: THREE.Object3D[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const object = root.getObjectByName(name);
    if (object) found.push(object);
    else missing.push(name);
  }
  return { found, missing };
}
```

`resolveMeshes` additionally descends a named group to collect its meshes — order-independent,
since every mesh beneath the node is included.

### Clone-on-write materials

The core of `lib/three/materials.ts`. A material is cloned the first time a given **mesh slot** is
written, cached against that slot, and reused thereafter:

```ts
private writable(mesh: THREE.Mesh, slotIndex: number, shared: boolean): THREE.Material | null {
  const materials = materialsOf(mesh);
  const current = materials[slotIndex];
  if (!current) return null;
  if (shared) return current;

  const key = `${mesh.uuid}:${slotIndex}`;
  const existing = this.slots.get(key);
  if (existing) return existing.clone;

  const clone = current.clone();
  clone.name = current.name;
  this.slots.set(key, { mesh, slotIndex, original: current, clone });

  if (Array.isArray(mesh.material)) {
    const next = [...mesh.material];
    next[slotIndex] = clone;
    mesh.material = next;
  } else {
    mesh.material = clone;
  }
  return clone;
}
```

Three properties follow: writes are scoped to the intended meshes; repeated changes allocate one
clone per slot, not one per click; every clone is tracked and disposable.

```ts
updateMaterials(meshes, materialNames, update, options = {}): number {
  let written = 0;
  const wanted = materialNames?.length ? new Set(materialNames) : null;

  for (const mesh of meshes) {
    const materials = materialsOf(mesh);
    for (let slotIndex = 0; slotIndex < materials.length; slotIndex++) {
      const material = materials[slotIndex];
      if (!material) continue;
      if (wanted && !wanted.has(material.name)) continue;   // ← spares BODY's other nine slots

      const target = this.writable(mesh, slotIndex, options.shared ?? false);
      if (!target) continue;
      update(target);
      target.needsUpdate = true;
      written++;
    }
  }
  return written;
}
```

The return count matters: `0` means nothing matched, which the controller reports as failure rather
than success.

> `Material.needsUpdate` is a **write-only setter** in three.js — reading it returns `undefined`.
> It increments `version`, which is what tests should assert on.

**When to clone and when not to.** Clone when the change must be scoped to a subset of a shared
material's users — the default. Pass `shared: true` only when every user should change together
*and* you want to avoid N redundant clones of an identical result. This codebase always clones:
the tyre option names all four wheels explicitly, so cloning yields the correct visual result while
leaving the donor tyre untouched, without depending on the sharing being incidental.

### Visibility

```ts
private setVisibility(option: CustomizationOption, visible: boolean): boolean {
  const { found } = resolveNodes(this.root, option.targetNodes ?? []);
  if (found.length === 0) return false;
  for (const node of found) node.visible = visible;

  if (visible) {
    const { found: hidden } = resolveNodes(this.root, option.hidesNodes ?? []);
    for (const node of hidden) node.visible = false;
  }
  return true;
}
```

`visible` is used rather than the previous `scale.y = 0.001` trick: it skips draw calls outright and
can't leave a flattened sliver on screen.

### Mesh replacement

```ts
export function attachToMount(mount: THREE.Object3D, asset: THREE.Object3D, optionId: string): void {
  detachFromMount(mount);                       // ← prevents duplicate accumulation
  markAttached(asset, optionId);
  asset.position.set(0, 0, 0);
  asset.quaternion.identity();
  asset.scale.set(1, 1, 1);
  mount.add(asset);
}

export function detachFromMount(mount: THREE.Object3D): void {
  for (const child of [...mount.children]) {    // ← copy: removal mutates the live array
    if (attachedOptionId(child) === undefined) continue;   // never touch GLB-supplied children
    mount.remove(child);
    disposeSubtree(child);
  }
}
```

Placement comes from the mount's own transform. Attachments are tagged in `userData`, so teardown
can distinguish them from authored geometry.

### Textures

`applyTexture` loads once per URL, sets `colorSpace = SRGBColorSpace` and `flipY = false` (the glTF
UV convention), and disposes the previous map **only if this writer created it** — a GLB-supplied
map may still be referenced by other meshes.

### Choosing an operation

| Situation | Operation | Why |
|---|---|---|
| Colour/finish change on existing geometry | `material-update` | Cheapest; no new geometry |
| Graphic on a flat surface | `texture-update` | One texture, no topology change |
| Variants that ship in the base GLB | `mesh-visibility` | Zero network, instant, no allocation |
| Part not in the base GLB, or too heavy to ship always | `mesh-replacement` | Loads on demand, cached |
| Different vehicle entirely | full model reload | The **only** case that justifies it |

Default to the cheapest row that works. Ordinary option changes must never reload the base asset
(~28 MiB as of §15's Draco compression) — the setup effect runs once and reads callbacks through
latest-value refs precisely so a prop change can't retrigger it.

---

## 7. Configuration Restoration Flow

```
1. GET /catalog/v1/vehicles/4runner.json          vehicle metadata
2. GET /catalog/v1/vehicles/4runner/options.json  option catalog   ─┐ in parallel
3. GET|POST /api/v1/configurations/…              configuration    ─┘
4. load base GLB                                  VehicleCanvas
5. hide donor nodes, ground on nominated nodes    prepareVehicleRoot
6. verifyNodeContract(root, catalog)              drop unsatisfiable options
7. attachScene(controller, configuration, catalog)
8. applyConfiguration(selections) in CATEGORY_APPLY_ORDER
9. controls become interactive
```

### Avoiding the three races

**Model vs. API.** The scene is only touched at step 7, when both the GLB and the configuration are
in hand. Whichever finishes last, there is no window where one exists without the other.

**React vs. loading.** `BuilderApp` resolves vehicle, catalog, and configuration into a *single*
`Bootstrap` state transition and doesn't render `VehicleCanvas` until it exists. There is no frame
in which a control is mounted but the scene can't honour it.

**Unmount vs. in-flight load.** A `cancelled` flag guards the async setup, and if the GLB resolves
after unmount the result is disposed rather than added:

```ts
if (cancelled) { disposeSubtree(root); return; }
```

### Deterministic ordering

```ts
async applyConfiguration(selections: SelectionMap) {
  // Return every written material slot to the material the GLB supplied. Without this, restoring a
  // configuration that selects no paint would leave the previous paint on screen.
  this.writer.restoreOriginals();

  for (const option of this.catalog.values()) {
    if (isMultiSelect(option.category)) await this.removeOption(option);
  }

  for (const category of CATEGORY_APPLY_ORDER) {
    for (const optionId of selections[category] ?? []) { /* apply, collecting applied/failed */ }
  }
}
```

Both resets matter, and each was found by a failing test:

- **Accumulating categories** are cleared across the whole catalog, so a restore doesn't inherit
  accessories from whatever was on screen before.
- **Material slots** are reverted to the GLB originals, so a rollback to a build with *no* paint
  selection actually removes the paint instead of leaving the rejected colour visible.

Together these make `applyConfiguration` idempotent and history-independent — the property behind
"a browser refresh reproduces the saved build exactly."

`paint` deliberately runs *after* `hood`/`panel`/`wheels`, so it repaints whichever variant is
currently mounted. `decal` follows `paint` so a graphic isn't overwritten by the colour beneath it.

---

## 8. Error Handling and Resource Disposal

### Failure modes

| Failure | Handling |
|---|---|
| Base GLB fails to load | Log, report to the user, fall back to `createProceduralVehicle()` — which uses the *same node and material names*, so the catalog still resolves |
| Optional asset fails | Promise removed from cache so a retry can succeed; option reports failure |
| Option's nodes absent | Caught at load by `verifyNodeContract`; option never rendered |
| Scene rejects a selection | `applyOption` returns `false` → rollback, error banner |
| API rejects a write | Rollback to `lastPersisted`, scene replayed, message surfaced |
| Network unreachable | `ApiError(0, "network_error")` — never a raw `TypeError` |
| Malformed error body | `body?.error?.code` — the error path must not itself throw |
| Stale revision | `409`, client reloads |

That last one was a real bug found while testing: `body?.error.code` throws a `TypeError` when a
response parses to `{}` — as a static host's 404 page does. It's fixed in both API clients.

### The disposal rule

**Dispose what you created; never dispose what you share.**

`instantiateAsset` uses `SkeletonUtils`' clone, which shares geometry and materials with the cached
source. Naively disposing a detached clone would blank every other instance and every future one.
So the cache registers what it owns, and `disposeSubtree` skips it:

```ts
const cacheOwnedResources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();

export function disposeSubtree(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.geometry && !cacheOwnedResources.has(object.geometry)) object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material) materials.add(material);
    }
  });

  for (const material of materials) {
    if (cacheOwnedResources.has(material)) continue;
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture && !cacheOwnedResources.has(value)) value.dispose();
    }
    material.dispose();
  }
}
```

`clearAssetCache()` is the one place cache-owned resources are released, on full teardown.

### Ownership

| Resource | Owner | Released by |
|---|---|---|
| Material clones | `MaterialWriter` | `controller.dispose()` |
| Textures it loaded | `MaterialWriter` | `controller.dispose()` |
| Attached asset clones | `attachToMount` | `detachFromMount` |
| Cached source scenes | `assetCache` | `clearAssetCache()` |
| Base scene geometry | the canvas effect | cleanup → `controller.dispose()` |
| Floor, grid, renderer, controls | the canvas effect | cleanup |

Two tests hold this line: 32 paint changes produce exactly **one** cloned slot, and 10 accessory
toggles leave the mesh count unchanged.

---

## 9. Recommended File Structure

```
app/
  api/v1/
    configurations/route.ts                    POST
    configurations/[configurationId]/route.ts  GET · PATCH · DELETE
    vehicles/[slug]/options/route.ts           GET (static)
  components/
    BuilderApp.tsx            bootstrap, layout, camera/lift
    CustomizationButton.tsx   the one control
    VehicleCanvas.tsx         renderer, camera, loading, contract verification

lib/
  api/
    client.ts                        existing vehicle SDK
    configurations.ts                configuration/option SDK + transport detection
    localConfigurationTransport.ts   browser-local fallback for the static export
    errors.ts                        ApiError + typed constructors
  data/
    options/4runner.ts               catalog, grounded in real node names
    options/index.ts                 server-side lookup
    vehicles/*                       existing
  server/
    configurationRepository.ts       repository interface + in-memory implementation
  state/
    configurationStore.ts            optimistic apply, batching, rollback
    useConfiguration.ts              useSyncExternalStore binding
  three/
    assets.ts                        cached loading, mounts, disposal
    materials.ts                     clone-on-write writes
    nodes.ts                         exact-name resolution, contract verification, dump
    proceduralParts.ts               ACCESSORY_* groups + fallback vehicle
    sceneController.ts               operation dispatch, deterministic restore
  types/
    customization.ts                 option + configuration schema
    vehicle.ts                       existing, plus hiddenNodeNames/groundingNodeNames

tests/
  fixtures/scene.ts     synthetic GLB mirroring the real structural traps
  mapping.test.ts       resolution, contract verification, catalog integrity   (16)
  sceneController.test.ts  material scoping, leaks, visibility, ordering       (15)
  validation.test.ts    API validation and trusted resolution                  (24)
  persistence.test.ts   repository CRUD, revisions, conflicts                  (12)
  restoration.test.ts   end-to-end selection → persistence → reload            (10)
  transport.test.ts     backend detection and local fallback                   (11)
```

---

## 10. Implementation Order

Each step compiles and passes tests on its own.

1. **Schema** — `lib/types/customization.ts`. No behaviour; everything else depends on it.
2. **Catalog** — `lib/data/options/*`. Dump the GLB first; write records against real names.
3. **Node layer** — `lib/three/nodes.ts` + the dump utility. Verify against the fixture.
4. **Materials** — `lib/three/materials.ts`. The clone-on-write test is the acceptance gate.
5. **Assets** — `lib/three/assets.ts`. Cache, mount, dispose; register cache-owned resources.
6. **Controller** — `lib/three/sceneController.ts`. Operation dispatch + `applyConfiguration`.
7. **Asset cleanup** — `hiddenNodeNames` / `groundingNodeNames`. Fixes the float; visible immediately.
8. **Backend** — validation, repository, routes. Tests here need no browser.
9. **Store** — `lib/state/*`. Optimistic apply, batching, rollback.
10. **UI** — `CustomizationButton`, then rewire `BuilderApp` and `VehicleCanvas`.
11. **Static fixtures** — options in `generate-static-api.ts`; transport fallback.
12. **D1 repository** — `lib/server/d1ConfigurationRepository.ts` implements `ConfigurationRepository`
    over Drizzle; `instrumentation.ts`'s `register()` calls `setConfigurationRepository` with it once
    a real `env.DB` binding resolves inside the Worker (no-op everywhere else — Node dev, tests,
    prerendering — where `InMemoryConfigurationRepository` stays active). Verified against a real
    local D1 instance, not just typechecked — see §5's "Persistence" note and
    `tests/d1ConfigurationRepository.test.ts`.

All twelve steps are done and tested on this branch.

---

## 11. Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Every button updates the intended 3D component | ✅ | `verifyNodeContract` drops unsatisfiable options before render; `applyOption` returning `false` triggers rollback |
| 2 | No dependency on mesh array position or traversal order | ✅ | `getObjectByName` + name-matched material slots; test reverses `BODY.children` and re-resolves |
| 3 | Every selection is a stable option id | ✅ | `selections` holds ids only; no hex, label, or node name is persisted |
| 4 | Backend rejects invalid combinations | ✅ | 24 validation tests: unknown ids, wrong category, bad year/grade, cardinality, cross-vehicle |
| 5 | Saved configurations reload after refresh | ✅ | `restoration.test.ts` builds, saves, resets the store, loads a fresh scene, asserts the scene matches |
| 6 | Paint doesn't affect unrelated meshes | ✅ | Test asserts `BODY`'s nine other slots are untouched *and* the donor sharing `wheel.metal` is unchanged |
| 7 | Repeated changes create no duplicates or leaks | ✅ | 32 paint changes → 1 cloned slot; 10 accessory toggles → unchanged mesh count |
| 8 | Failed API calls report and restore | ✅ | Error banner + `rollback` replaying `lastPersisted`, awaited so the scene settles before the failure is reported |
| 9 | Base GLB not reloaded for option changes | ✅ | Setup effect keyed only on `threeDConfig`, callbacks read via latest-value refs |
| 10 | Tests for mapping, validation, persistence, restoration | ✅ | 88 tests across six files |

```
$ npm run lint         # clean (eslint.config.js added; catches real react-hooks issues, not noise)
$ npm run typecheck    # clean
$ npm test             # 208 passed (16 files), including a CI-time check that the catalog resolves
                        # against the real, checked-in GLB (tests/glbContract.test.ts), 13 tests of
                        # D1ConfigurationRepository against a real local D1 instance, 7 tests of the
                        # write rate limiter against both a fake and a real local binding, 9 tests
                        # proving the Tacoma/Camry catalogs resolve against the real procedural
                        # fallback vehicle they actually render with, 10 real component tests
                        # (tests/components/*.test.tsx, jsdom) for CustomizationButton and BuilderApp,
                        # and 23 tests of lib/api/query.ts's filter/pagination logic, including
                        # against the real three-vehicle catalog
$ npm run build        # 11 routes, static export succeeds — including per-vehicle routes /4runner,
                        # /tacoma, /camry (app/[slug]/page.tsx), the /explore lineup page, and
                        # /compare
$ npm run test:e2e     # 5 passed — real Playwright against the built static export
                        # (visual regression + a real-browser build-and-restore flow across a
                        # page reload; needs `npm run build` first)
```

### Known gaps

- **Hood, panel, decal, and interior options are contract-gated.** The current GLB has no such
  nodes (it's exterior-only — no hood variants, no decal UVs, no seat/dash geometry); the catalog
  records are written and tested, and activate on re-export with no code change.
- **D1 read-then-write isn't fully ACID.** `D1ConfigurationRepository.update()` re-checks `revision`
  in its own `WHERE` clause as a safety net, but the preceding existence/ownership read is a separate
  statement from the write batch — see §5's "Persistence" note. Acceptable for this workload; would
  need revisiting under real write contention.
- **`wrangler.jsonc`'s `database_id` is still a placeholder.** Everything downstream (the repository,
  the migration, `instrumentation.ts`'s binding logic) is implemented and verified against a real
  local D1 instance; only `wrangler d1 create toyota-showroom` against an actual Cloudflare account
  — which this environment has no credentials for — remains to make it live in production.
- **Tacoma and Camry render the procedural fallback vehicle, not a real model.** Neither has a GLB in
  this repo (`threeDConfig.hasModel: false`), so both use `createProceduralVehicle()`
  (`lib/three/proceduralParts.ts`) — a low-detail stand-in, not a placeholder-only state. Their
  catalogs (`lib/data/options/{tacoma,camry}.ts`) are written against that fallback's node/material
  names and are genuinely functional today, verified in
  `tests/proceduralVehicleCatalogs.test.ts`, not gated. Swapping in real GLBs later needs no catalog
  changes as long as the new assets follow the same naming contract (§3).
- **Owner tokens have no recovery path.** Losing the token (clearing localStorage, switching
  browsers) permanently locks out further writes to that configuration; only reads keep working.
  Acceptable for the anonymous, no-accounts v1 this implements — revisit if user accounts land.
- **A shared link (§4, "Share configuration") only resolves cross-browser when a real backend is
  live.** `localConfigurationTransport` — the fallback `lib/api/configurations.ts` uses once it
  detects there's no request-aware backend (e.g. the plain GitHub Pages export, §5's deployment
  note) — persists to `window.localStorage`, so a link shared from that deployment only opens
  correctly in the same browser that created it. On the Cloudflare Worker + D1 deployment (§5,
  "Persistence"), the configuration is server-side and the link works everywhere. Not fixable
  without a real backend, which is the same standing dependency the D1 `database_id` placeholder
  already documents above.
- **Calipers were repositioned and donor geometry deleted at the GLB source** (§1, "Fixing the
  donor geometry at the source"), not just hidden at runtime anymore. What's still genuinely open:
  the calipers' own local geometry/orientation was never visually re-verified up close (no Blender,
  no practical way to script a close-up render check in this environment) — if they look wrong
  once actually looked at, that's real 3D-authoring work this fix didn't and couldn't do.
- **Visual regression (§4, "Visual regression testing") covers DOM/CSS pages only** — `/explore`,
  `/compare`, and the builder's chrome with the 3D canvas masked out, not the canvas's own content,
  for reasons that section explains. And its committed baselines carry a disclosed risk: generated
  against an older Chromium build than real CI installs (that section again) — the first real CI
  run may need `npm run test:e2e:update` and a baseline recommit if the two builds render
  differently enough to trip `maxDiffPixelRatio`.
- **Lift height doesn't survive a reload or a share link.** Confirmed while writing
  `tests/e2e/build-and-restore.spec.ts` (§4): `lift` is `BuilderApp.tsx`'s own `useState(2)`, never
  written into `VehicleConfiguration`. Intentional as far as the schema goes (`lib/types/
  customization.ts` has no field for it) — recorded here because a visitor reloading a shared link
  would reasonably expect a chosen ride height to come back with everything else.
- **Rate limiting is keyed on IP, not on identity.** `enforceConfigWriteRateLimit`
  (`lib/server/rateLimit.ts`) throttles POST/PATCH/DELETE at 30 writes/minute per `cf-connecting-ip`,
  which is the best available key given Task 10's anonymous, no-accounts ownership model — a NAT'd
  office or a mobile carrier's shared egress IP shares one budget. Revisit if user accounts land.
- **`BuilderApp.tsx`'s garage/share/terrain controls (merged in from a parallel work stream) have
  no dedicated tests.** `tests/components/BuilderApp.test.tsx` (§4, "Component tests") covers
  bootstrap, the grade selector, and reset — not `saveToGarage`, `share`, or the terrain/lighting
  toggles.
- **The left rail's "Systems" button labels don't all match the category they switch to** — e.g.
  "Lighting" opens the `accessory` category, "Accessories" opens `decal` (§4, "Component tests").
  Discovered while writing `BuilderApp.test.tsx`, not introduced by it; the mismatch predates this
  task, in the same parallel work stream that added the single-category redesign.
- **This branch merged a substantial parallel work stream from `main`** (commit range `ee6d097..f5c67a7`):
  garage save/share (`lib/showroom/buildTools.ts`), terrain/lighting scene controls, a single-category
  builder view, authored wheel/tire glTFs replacing the 4Runner's baked-in running gear, a locally
  vendored Draco decoder (`public/draco/` — present on disk but not actually wired into the loader
  configuration until §14 fixed it), and a new RAV4 render asset set
  (`public/renders/rav4-2024/`, not yet wired into `lib/data/vehicles` —
  no `rav4` entry exists in `VEHICLES` yet). The merge commit documents the conflict resolution for
  the three files both streams touched (`BuilderApp.tsx`, `VehicleCanvas.tsx`,
  `lib/data/vehicles/4runner.ts`).
- **The static export's CSP can't set `frame-ancestors`.** §13 explains why (only a real HTTP header
  can carry that directive; a `<meta http-equiv>` tag, the only mechanism GitHub Pages allows, can't)
  — this app has no click-jacking protection at all on that deployment target. The Worker side
  (`app/api/v1/**`) does send `X-Frame-Options: DENY` and `frame-ancestors 'none'` for real.
- **`public/_headers`' cache rules (§17) have no live effect on either current deployment target.**
  GitHub Pages supports no custom-header mechanism at all; the Cloudflare Worker doesn't serve
  static assets today because the base GLB still exceeds Workers Static Assets' 25 MiB single-file
  cap even after §15's compression (28.1 MiB). The config is real and verified against the actual
  build output (§17); it activates with no further change once either constraint lifts.

---

## 12. Deployment

For the operational step-by-step (first-time D1/Worker setup, routine deploys, post-deploy
verification, rollback) see `docs/DEPLOYMENT_RUNBOOK.md`. This section explains why the setup
looks the way it does; the runbook is for actually doing it.

Two independent targets, matching §5's "Deployment note": `.github/workflows/pages.yml` deploys the
static export (`dist/client`) to GitHub Pages on every push to `main`; the Worker (`dist/server`,
the dynamic `/api/v1/configurations/**` routes) is deployed separately, by hand today —
`npm run deploy` — since there is no CI-driven *production* Worker deploy workflow. There is now a
CI-driven **staging** one.

### `.github/workflows/deploy-staging.yml`

Runs on every pull request targeting `main` (and via manual `workflow_dispatch`): builds, applies
D1 migrations to a separate `toyota-showroom-staging` database, then deploys the Worker under
`wrangler.jsonc`'s new `env.staging` block — its own Worker name (`toyota-showroom-staging`), its
own D1 database, its own rate-limiter namespace (`1002`, distinct from production's `1001` — a
namespace id is account-scoped, not Worker-scoped, so reusing production's would mean a PR's
staging traffic and production traffic drew from the same 30-writes/minute budget). Both the
migration and deploy steps are skipped — not failed — when `CLOUDFLARE_API_TOKEN` /
`CLOUDFLARE_ACCOUNT_ID` repository secrets aren't set, logged via `::notice::` rather than a red X,
the same posture `wrangler.jsonc`'s placeholder `database_id`s already take toward credentials this
environment doesn't have. To actually make this deploy something:

1. `wrangler d1 create toyota-showroom-staging`, paste the id into
   `wrangler.jsonc`'s `env.staging.d1_databases[0].database_id`.
2. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets (Settings → Secrets
   and variables → Actions).

### The redirected-configuration gotcha

Discovered while wiring this up, and non-obvious enough to record: `@cloudflare/vite-plugin`
auto-generates `dist/client/wrangler.json` during `npm run build` — a flattened snapshot of
`wrangler.jsonc` — and `wrangler deploy` prefers it by default via `.wrangler/deploy/config.json`
("Using redirected Wrangler configuration"). That snapshot does not re-resolve `--env staging`'s
bindings; passing `--env staging` against the redirected config silently deploys with
**production's** D1 binding under the staging Worker's name — the opposite of what a staging
deployment is supposed to isolate. `wrangler deploy ... --config wrangler.jsonc` (explicit, not
relying on the redirect) is what makes `--env staging` actually resolve `toyota-showroom-staging`'s
bindings; both `npm run deploy` and `npm run deploy:staging` pass it now, and production's script
additionally passes `--env ""` to silence Wrangler's own "multiple environments defined, no target
specified" warning now that `env.staging` exists. Verified by dry-running both
(`wrangler deploy dist/server/index.js --no-bundle --env staging --dry-run`, with and without
`--config wrangler.jsonc`) and comparing which D1 database name each reports.

---

## 13. Security Headers

Two independent surfaces, matching §5/§12's "two deployment targets," each needing its own
delivery mechanism because neither can reach the other:

### `app/api/v1/**` (`lib/server/securityHeaders.ts`)

The Worker side can set real HTTP response headers, so it gets the full set:
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, a locked-down `Permissions-Policy`, and
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` — every response here is
pure JSON, never rendered as HTML, so nothing on this surface should ever load a script, style,
image, or frame at all. `withSecurityHeaders()` merges this baseline under whatever a route already
set (`Cache-Control`, `ETag`, `Retry-After`, `Location`); every `app/api/v1/**/route.ts` response
now goes through it, including three vehicle-catalog routes whose error paths previously duplicated
`NextResponse.json(toErrorBody(err), ...)` inline instead of calling the shared `errorResponse()`
helper — consolidated onto it as part of this change, since that duplication was exactly the one
place the new baseline headers would otherwise have needed repeating a fourth time.

### The static HTML shell (`app/layout.tsx`)

GitHub Pages has no server to attach response headers with, so a `<meta http-equiv=
"Content-Security-Policy">` tag in the root layout is the only mechanism that can reach this
surface at all. Per spec, that delivery mechanism **cannot** enforce `frame-ancestors` or
`sandbox` — those directives are only honored over a real HTTP header — so this app has no way to
prevent itself from being framed on the plain static export. A real, disclosed gap, not an
oversight; fixable only by moving the static site behind something that can set headers (the
Cloudflare Worker, once §12/Task 23's asset-size dependency clears, or Cloudflare Pages instead of
GitHub Pages).

The policy itself (`default-src 'self'`, plus per-directive allowances) needed two deliberate,
non-default relaxations, both verified empirically with Playwright — console-monitoring every
navigation for CSP violation reports across the builder, explore, and compare pages, not assumed
safe from reading the directive list:

- `'unsafe-inline'` on `script-src`/`style-src`. The RSC hydration payload ships as an inline
  `<script>` whose content differs per prerendered page (a nonce needs a per-request server; a hash
  needs a build step keyed to each page's own differing content — both judged not worth the
  complexity here). `CustomizationButton.tsx`'s paint swatches (`style={{ background:
  option.materialConfig?.color }}`) need the same allowance for inline style attributes.
- `'wasm-unsafe-eval'` on `script-src`, and `blob:`/`data:` on `connect-src`. Required by the
  vendored Draco/Basis decoders' Emscripten-generated glue code and by `GLTFLoader`'s internal
  loaders, which `fetch()` both blob and data URLs directly — confirmed by running the CSP against
  the real builder page and reading which specific `connect-src` violations came back before adding
  either allowance, not guessed in advance.

**A real, unrelated bug found and fixed while doing this verification.** Loading `/compare/` with a
non-empty `?vehicles=` query threw React error #418 (hydration mismatch) — pre-existing, reproduced
against the already-committed code with no security-header changes applied at all, so unrelated to
this task's own changes; just found by the same empirical checking. `app/compare/page.tsx`'s
`picked` state was seeded by a `useState` lazy initializer reading `window.location.search`
directly: on the server prerender, `window` doesn't exist, so that initializer always produced
`[]`; on the client's first paint (before hydration reconciles), the same initializer runs for
real and can produce a non-empty array — which flips the "Update comparison" link (gated on
`picked.length >= MIN_COMPARE`) from absent to present between the two passes, a genuine
server/client mismatch. Fixed by starting `picked` at `[]` unconditionally and moving the
`window.location.search` read into a mount-only `useEffect` — the standard, React-endorsed shape
for "value only available client-side, needed once after mount," with a targeted
`eslint-disable-next-line react-hooks/set-state-in-effect` and a comment explaining why this
specific case isn't the derived-state-sync anti-pattern that rule exists to catch. Verified fixed
by loading `/compare/?vehicles=4runner,tacoma` with Playwright and confirming zero `pageerror`
events, both before (red) and after (green) the fix.

---

## 14. Vendoring the Draco Decoder Locally

Surfaced by §13's CSP verification, fixed here: loading the builder page issued real network
requests to `https://www.gstatic.com/draco/versioned/decoders/1.5.7/...` even though
`public/draco/` (`draco_decoder.js`, `draco_decoder.wasm`, `draco_wasm_wrapper.js` — merged in from
the parallel work stream §1/§4/§11 already document) had vendored a local copy of exactly those
three files — the loader configuration just wasn't pointed at it. `lib/three/assets.ts`'s
`DRACO_DECODER_PATH` was still the literal Google CDN URL.

Fixed by pointing it at `` `${import.meta.env.BASE_URL}draco/` `` instead — the same
`import.meta.env.BASE_URL` prefixing every other asset URL this app emits already uses
(`lib/api/client.ts`'s `withBasePath`), required once GitHub Pages serves the whole site under
`/toyota-showroom/`. Two independent reasons this needed fixing, either sufficient alone: §13's CSP
intentionally does not allow `connect-src` to reach third-party hosts, so the CDN path was already
being silently blocked there; and a CDN dependency is one more thing that can be down,
rate-limited, or blocked by a restrictive network, for a feature (the optional wheel/tyre glTF
replacements — the base 4Runner GLB has no Draco-compressed geometry of its own) that has nothing
to do with needing the public internet.

**Verified with real network-request inspection, not just a passing build.** Loaded the builder
page with Playwright and logged every request matching `/draco/`: before the fix,
`https://www.gstatic.com/draco/...`; after, `http://.../toyota-showroom/draco/draco_wasm_wrapper.js`
and `.../draco_decoder.wasm` — confirmed the browser is actually fetching the vendored files, not
just that the constant changed. `tests/e2e/visual.spec.ts`'s builder-chrome test now asserts zero
page errors after `waitForLoadState("networkidle")` (previously it special-cased away exactly the
"Failed to fetch" error this fix eliminates); reverting the fix and rerunning turns that assertion
red, the same deliberate-bug verification used throughout this project. That revert-and-rerun also
found a real timing gap in the test's *first* version — asserting immediately after the screenshot,
before `installWheelAndTireAssets`'s CSP-blocked fetch had time to reject, let the regression pass
silently; `waitForLoadState("networkidle")` closed it.

---

## 15. Compressing the Base GLB Payload (`scripts/compress-glb.mjs`)

§1's donor-geometry fix got the shipped 4Runner GLB from 56.9 MiB to 38.7 MiB by deleting dead
weight; this is the second, independent lever — compressing what's left, since nothing more in the
file is unused.

**Measured before choosing a lever.** A raw JSON-chunk dump of the (post-§1) GLB found 13 embedded
images totalling ~0.16 MiB out of a ~38.6 MiB binary buffer — essentially none of this file's size
is texture data. The weight is geometry: positions, normals, UVs, and indices across 19 meshes.
That rules out texture re-encoding (the usual first lever for a bloated glTF) and points at mesh
compression instead.

**`KHR_draco_mesh_compression` via `@gltf-transform/functions`'s `draco()` transform**, encoder
supplied by the `draco3dgltf` npm package (`method: "edgebreaker"` — better ratios than
`"sequential"` for the connected surfaces a vehicle body is; quantization left at
`gltf-transform`'s own defaults — position 14 bits, normal 10, texcoord 12 — rather than overridden
blind). This is also the first real workout for the decoder §14 vendored and wired in: that fix
made `public/draco/`'s decoder reachable and correctly configured, but the *base* GLB shipped
uncompressed the whole time, so nothing had actually exercised the decode path against it until
this task compressed the file it loads.

**Result: 38.7 MiB → 28.1 MiB, a further ~27% reduction** (combined with §1's fix, ~50% off the
original 56.9 MiB shipped asset).

**Verification:**
- A raw JSON-chunk dump of the compressed file confirms `extensionsRequired` now includes
  `KHR_draco_mesh_compression`, node count is unchanged at 26 (all four `MOUNT_WHEEL_*` markers and
  the rest of §1's `keepLeaves: true` set survived untouched — this transform only rewrites mesh
  accessors, not the node graph), and mesh/material/image counts are unchanged.
- `npm test` — 208/208 unaffected (`tests/glbContract.test.ts` exercises `glbInspect` against
  synthetic fixtures, not the shipped binary, so it wasn't expected to catch a compression
  regression on its own — the real signal is the next two).
- `npm run build` + `npm run test:e2e` — all 5 Playwright tests green against the *compressed*
  file, including both `build-and-restore.spec.ts` tests, which apply real option selections to a
  live WebGL scene built from this exact GLB. A silently broken decode (wrong decoder version,
  mismatched quantization, a corrupted write) would show up there as a scene that never finishes
  loading or a `pageerror`, not as a quiet size difference — this is the same class of "screenshot
  alone would miss it" gap §4's visual-regression note and §14's network-inspection check exist to
  close.
- Backed up the pre-compression file before running the transform; restorable from that backup if
  a problem surfaced post-verification (none did).

Not attempted: re-running Draco with a different quantization profile to chase a smaller file at
the cost of geometry precision. The defaults already produced a real, verified reduction without
touching visual fidelity, and this repo has no practical way to script a "does it still look right
up close" check (§1's same caliper-geometry caveat) — tuning further without that feedback would be
guessing.

---

## 16. Code-Splitting the Three.js Renderer

Three.js (core + the WebGPU renderer + `OrbitControls` + loaders) plus `gsap` was the single
heaviest dependency this app ships, and it was bundled directly into the same chunk as
`BuilderApp.tsx` — the component every route with a canvas mounts first, before the scene itself is
even needed. `npm run build` flagged this on its own ("Some chunks are larger than 500 kB after
minification"): the pre-split chunk was 1.38 MiB.

**Fix: `React.lazy` + `Suspense`, not a build-config change.** `app/components/BuilderApp.tsx` no
longer imports `VehicleCanvas` directly; it imports only its type (`import type { CameraPreset }`,
erased at build time) and lazily loads the component itself:

```ts
const VehicleCanvas = lazy(() => import("./VehicleCanvas").then((module) => ({ default: module.VehicleCanvas })));
```

wrapped at its render site in `<Suspense fallback={...}>` with a placeholder that reuses the real
`.vehicle-canvas` element's CSS (`app/globals.css`) so nothing shifts layout while the chunk streams
in. This was the correct lever over a bundler `manualChunks` tweak because the *goal* isn't just a
smaller file on disk — it's that the builder's own chrome (header, grade rail, right panel) can
paint and become interactive without waiting on a ~1.3 MiB parse, and that routes with no canvas at
all (`/explore`, `/compare`) never fetch it in the first place.

**Result:** `BuilderApp`'s own chunk dropped from 1.38 MiB to ~51 KB; Three.js/gsap now ship in a
separate `VehicleCanvas-*.js` chunk (~1.33 MiB) fetched only when a route actually mounts the
canvas. The 500 kB build warning is gone.

**Verified with real network inspection** (`tests/e2e/code-splitting.spec.ts`), not just chunk
files existing on disk — a stray shared import could still pull Three.js into a chunk `/explore`
loads even with a separate file present. Two tests: `/explore` and `/compare` are asserted to make
*zero* requests matching `/assets/VehicleCanvas-*`, and the builder page (`/4runner/`) is asserted
to make at least one. Deliberate-bug check: reverted the `lazy()` change back to a static import,
rebuilt — the `VehicleCanvas-*` chunk stopped existing entirely and the "builder page fetches it"
test correctly failed (`Timeout ... Received: 0`), proving the test is a real regression signal and
not vacuously true. The complementary "`/explore`/`/compare` never fetch it" test stayed green in
both states, which is expected and not a gap: those routes never import `BuilderApp` at all
(`app/[slug]/page.tsx` and `app/page.tsx` are the only two importers), so that invariant holds
regardless of whether the split exists — it documents that existing isolation rather than testing
this task's change specifically.

Full local suite re-verified after: `npm test` (208/208), `npm run build`, and the full
`npm run test:e2e` (7/7, including both real-GLB `build-and-restore.spec.ts` tests against the
now-lazy-loaded canvas).

---

## 17. Cache Headers for Static Assets (`public/_headers`)

**A real, disclosed gap first: neither of this app's two live deployment targets can serve custom
cache headers today.** GitHub Pages (the only currently-*deployed* static host,
`.github/workflows/pages.yml`) has no config mechanism for custom HTTP response headers at all — no
`_headers`-file equivalent, confirmed against GitHub's own community discussions, not assumed. And
the Cloudflare Worker (`app/api/v1/**` only) doesn't serve `dist/client` as static assets in the
first place — `wrangler.jsonc`'s own comment already documents why: the base GLB exceeds Workers
Static Assets' 25 MiB single-file cap, even after §15's compression (28.1 MiB, still over). So
`public/_headers`, below, is real, correct, verified-against-the-actual-build config with **no live
effect on any deployment this repo currently has running** — the same class of standing,
infrastructure-gated gap as the D1 `database_id` placeholder (§1) and the staging Worker's
credential-gated deploy (§12). It activates automatically, with no further code change, the day
either this project's static site moves to a Cloudflare-hosted target, or the GLB drops under the
25 MiB Workers Static Assets cap.

**What it does, once live.** `public/` (copied verbatim into `dist/client` by vinext's build, same
as `public/draco/`'s vendored decoder files) already gets one `_headers` rule generated
automatically by vinext itself: `/assets/*` (vite's content-hashed JS/CSS chunk output) cached
`immutable` for a year — safe, since a new build always produces a new hash. **Providing a
hand-authored `public/_headers` replaces that generated file entirely rather than merging with
it** — confirmed empirically, not assumed: a build with only a `/models/*` rule in
`public/_headers` produced a `dist/client/_headers` with no `/assets/*` rule left in it at all.
`public/_headers`'s own first rule is therefore that same `/assets/*` immutable line, carried
forward on purpose, plus new rules for the real weight vinext's default doesn't cover — none of it
content-hashed, since `scripts/fix-donor-geometry.mjs` and `scripts/compress-glb.mjs` (§1, §15)
both edit `public/models/*.glb` in place rather than renaming it on change, so `immutable` would be
wrong there: `/models/*`, `/draco/*`, `/renders/*`, and `/images/*` each get `public,
max-age=86400, must-revalidate` — a real cache win for what includes the single largest asset this
app ships, bounded to a day so a re-export or a re-compression is never stuck behind a stale cache
for long. `/catalog/*` (the static-export mirror of `GET /api/v1/vehicles/**`,
`scripts/generate-static-api.ts`'s prebuild output) matches the live endpoint's own
`max-age=300`. Paths outside all of these — the HTML shells, the `.rsc` payloads — are left to
Cloudflare's own platform default (cacheable, but revalidated on every use), which is already
correct for them.

**Verified two ways, since no live deployment can confirm real response headers:**
- `tests/staticHeaders.test.ts` parses `public/_headers` and checks it against the real `public/`
  tree: the `/assets/*` immutable rule is present with the exact expected value; every other rule
  uses a bounded `max-age` rather than `immutable`; every rule's path resolves to a real directory
  under `public/`; and every top-level `public/` directory has a matching rule (catches a new asset
  folder landing with no cache policy at all, silently falling back to revalidate-always). Two
  deliberate-bug checks before trusting it: removing the `/assets/*` rule failed the first test;
  adding an uncovered `public/fonts/` directory failed the last one.
- `npm run build` then `diff public/_headers dist/client/_headers` — byte-identical, confirming
  vinext copies it verbatim rather than transforming or dropping it.

Not attempted: standing up a real Cloudflare Pages/Workers Static Assets deployment in this
environment to confirm actual HTTP response headers, since (as §1's D1 note and §12 already
establish) this environment has no Cloudflare account credentials to deploy anything real with.
