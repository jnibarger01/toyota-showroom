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

### Two defects found in the asset itself

Both were measured by parsing the GLB's JSON chunk and accessor bounds, not guessed.

**Donor geometry at the world origin.** Six nodes sit at the scene root with no transform and
geometry authored around the origin — `322-1790(MD010)`, `322-1790(MD010).001`,
`BFGoodrich_ALL_Terrain_TA_KO2`, `FRONT_BRAKES`, `REAR_BRAKES`, and `Jet Black`. The last is a
**radius-1 sphere** spanning y −1 → 1. All four `PLACED_AOOA_caliper_*` nodes are at the origin
too, rather than at their wheels.

**The vehicle floated.** Grounding used a `Box3` over the whole scene:

```ts
const box = new THREE.Box3().setFromObject(root);   // y: -1 → 1.82, because of the sphere
root.position.sub(center);
root.position.y += size.y / 2;                       // → y = 1.0
```

The tyres' lowest point is y 0.12, so the 4Runner hovered roughly 1.1 units above the grid.

Fixed by two data fields, not a heuristic (`lib/data/vehicles/4runner.ts`):

```ts
hiddenNodeNames: ["322-1790(MD010)", /* … */, "Jet Black", "PLACED_AOOA_caliper_front_left", /* … */],
groundingNodeNames: ["BODY", "PLACED_KO3_front_left", /* …the four tyres */],
```

`prepareVehicleRoot` (`app/components/VehicleCanvas.tsx`) hides the first list and computes the
bounding box from the second.

> **Blender follow-up:** the calipers should be re-parented to the `MOUNT_WHEEL_*` nodes and the
> donor objects deleted before the next export. Until then they are hidden at runtime, which costs
> nothing visually — at the origin they are fully enclosed by the body.

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

Default to the cheapest row that works. Ordinary option changes must never reload the 57 MB base
asset — the setup effect runs once and reads callbacks through latest-value refs precisely so a
prop change can't retrigger it.

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
$ npm test             # 185 passed (15 files), including a CI-time check that the catalog resolves
                        # against the real, checked-in GLB (tests/glbContract.test.ts), 13 tests of
                        # D1ConfigurationRepository against a real local D1 instance, 7 tests of the
                        # write rate limiter against both a fake and a real local binding, 9 tests
                        # proving the Tacoma/Camry catalogs resolve against the real procedural
                        # fallback vehicle they actually render with, and 10 real component tests
                        # (tests/components/*.test.tsx, jsdom) for CustomizationButton and BuilderApp
$ npm run build        # 11 routes, static export succeeds — including per-vehicle routes /4runner,
                        # /tacoma, /camry (app/[slug]/page.tsx), the /explore lineup page, and
                        # /compare
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
- **Calipers and donor geometry are hidden, not deleted.** The Blender source should be corrected.
- **No visual regression testing.** Correctness here is asserted structurally, not by pixels.
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
- **The `/explore` lineup page (§4, "Vehicle lineup") fetches the whole catalog and filters client-side
  without pagination UI.** `lib/api/query.ts`'s `paginateAndFilter`/`queryVehicles` already support it
  and `MAX_PAGE_SIZE` is used defensively, but with three vehicles today a page-2 control has nothing
  to page to. Wiring pagination (or virtualizing the grid) once the catalog is large enough to need it
  is planned work.
- **This branch merged a substantial parallel work stream from `main`** (commit range `ee6d097..f5c67a7`):
  garage save/share (`lib/showroom/buildTools.ts`), terrain/lighting scene controls, a single-category
  builder view, authored wheel/tire glTFs replacing the 4Runner's baked-in running gear, a locally
  vendored Draco decoder (`public/draco/`), and a new RAV4 render asset set (`public/renders/rav4-2024/`,
  not yet wired into `lib/data/vehicles` — no `rav4` entry exists in `VEHICLES` yet). The merge commit
  documents the conflict resolution for the three files both streams touched
  (`BuilderApp.tsx`, `VehicleCanvas.tsx`, `lib/data/vehicles/4runner.ts`).

---

## 12. Deployment

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
