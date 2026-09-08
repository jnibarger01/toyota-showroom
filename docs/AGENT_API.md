# Agent-authorable scene API

Mission Priority 7. `lib/agent/sceneApi.ts`'s `VehicleSceneAgentApi` is the typed local boundary a
future governed MCP adapter would expose to Hermes/Codex-style agents — designed now, while the
runtime API it sits on (`VehicleSceneController` + `SceneRegistry`, Priority 1) is freshly stable,
but **not** wired to MCP itself. Mission Non-Goals: *"Do not create an MCP layer before the runtime
API is stable"* and *"MCP is an adapter, not the authority"* — this module is the authority; an MCP
server built later is a thin transport translating each capability below to a tool call and back.

## Design rules

1. **No raw Three.js crosses the boundary.** Every read returns plain, serializable data — string
   ids, labels, capability tags, numeric tuples. `PartSummary`, `SceneInspection`, `FocusTarget` are
   the entire read-side vocabulary; nothing else leaves the module. An agent can never hold a live
   `THREE.Object3D`/`Material` reference or call an arbitrary method on one.
2. **Mutations take an opaque catalog id, never raw scene data.** `setPaint("paint-3u5-barcelona-red")`
   resolves through `VehicleSceneController.getOption`, the exact lookup `applyConfiguration`
   already uses — never a node name, material name, or asset URL supplied by the caller. This
   mirrors a stance already load-bearing elsewhere in this codebase (`docs/INTEGRATION_GUIDE.md`'s
   customization schema: *"Every option by its stable `id`... never sent from the browser as
   instructions"*) — the agent boundary inherits it rather than reinventing it.
3. **Read and mutate are two explicit entry points** (`api.read.*`, `api.mutate.*`), not one flat
   method list, so a caller — today's application code, tomorrow's ACS-wrapped MCP tool dispatch —
   can apply a blanket policy ("reads always allowed; mutations need authorization") by branching on
   which namespace a call belongs to, without inspecting each capability's implementation.
4. **The capability manifest (`AGENT_CAPABILITIES`) is static, declared data**, not derived by
   reflecting over the class — so it can't silently gain an entry because a helper method happened
   to be public. It is what a future MCP tool listing enumerates without invoking anything, and
   what an ACS policy would key its per-capability rules on.

## What is implemented and real today

Everything below is backed by `VehicleSceneController`, itself backed by `SceneRegistry` and
`three-mesh-bvh` picking (Priority 1) — no stubs, all covered by `tests/agentSceneApi.test.ts`
(26 tests total, 15 of them scene/vehicle capabilities and 11 camera capabilities, real fixture
geometry, real material writes, and — for the camera rows — a real `CameraController` against a
real `jsdom` DOM element):

| Capability | Kind | Backed by |
|---|---|---|
| `scene.inspect` | read | `controller.sceneMapReport`, `hoveredPartId`, `selectedPartId` |
| `scene.listParts` | read | `SceneRegistry.list/findByType/findByCapability` |
| `scene.getPart` | read | `SceneRegistry.get` |
| `scene.focusPart` | read | `THREE.Box3.setFromObject` on the part's registered object |
| `scene.pick` | read | `VehiclePicker` (BVH-accelerated raycast) |
| `vehicle.selectPart` / `vehicle.hoverPart` | mutation | `controller.selectPart` / `hoverPart` |
| `vehicle.setPaint` / `vehicle.setWheels` | mutation | `controller.getOption` + `applyOption`, category-checked |
| `vehicle.setAccessory` | mutation | `controller.applyOption` / `removeOption`, category-checked |
| `vehicle.applyConfiguration` | mutation | `controller.applyConfiguration` |
| `camera.getState` | read | `CameraController.getState()` (Priority 3/4) |
| `camera.getPresets` | read | `CameraController.getPresets()` |
| `camera.setPreset` | mutation | `CameraController.transitionToPreset`, by-id lookup, fail-closed on an unknown id |
| `camera.focusPart` | mutation | composes `read.focusPart` (real bounding sphere) with `CameraController.focusPoint` |
| `camera.orbit` | mutation | `CameraController.orbitBy`, fail-closed on a non-finite delta |
| `camera.reset` | mutation | `CameraController.resetToPreset`, to whichever preset is currently active |

The camera row above is exactly the seam this document originally described below as the next
evolution — `CameraController` (`lib/three/cameraController.ts`, Priority 3) is real now, and
`VehicleSceneAgentApi`'s constructor takes it as a second, optional argument:
`new VehicleSceneAgentApi(controller, cameraController)`. Optional because nothing in the live app
constructs this class with a camera yet (see "The runtime remains usable without MCP" below) — every
`camera.*` read returns `undefined` and every `camera.*` mutation fails closed with a reason when no
`CameraController` was passed, the same standard `selectPart`/`hoverPart` already hold for an
unknown part id. Covered by `tests/agentSceneApi.test.ts`'s "VehicleSceneAgentApi camera
capabilities (Priority 4)" describe block (both with and without a camera wired).

## What is deliberately not implemented yet, and why

The mission's example vocabulary also names `environment.setPreset`, `lighting.setPreset`, and
`showroom.inspect`/`showroom.capture`. These are **not** on `VehicleSceneAgentApi` today — not
because the runtime authority is missing (`EnvironmentController`, `lib/three/
environmentController.ts`, Priority 5, is real and owns exactly this state now — terrain/preset
palette, quality-driven shadow/light adjustment, the HDRI lifecycle) but because no mission
priority has asked for that composition yet, the same way Priority 4 was the explicit trigger for
`camera.*` only once `CameraController` existed. Wiring it in later is the same shape of change
`camera.*` just was: an optional third `VehicleSceneAgentApi` constructor argument
(`EnvironmentController`), fail-closed reads/mutations when absent — not a redesign. Until then,
adding `environment.setPreset()` here would mean one of two dishonest things: a method that
silently does nothing (violates this codebase's own standard — see `VehicleSceneController.
applyOption`'s doc comment on why a no-op is treated as a bug, not a graceful default), or reaching
past this module into React component internals it has no business touching (the opposite of the
boundary this module exists to hold — configurator/application state and scene/runtime state are
supposed to stay separated, not have the "typed API" module quietly bridge them by calling into a
specific component's props). Terrain/environment-preset *selection* itself stays a `VehicleCanvas`/
`BuilderApp` React prop either way — an application preference, not scene state (see
`EnvironmentController`'s own doc comment on that distinction).

`showroom.inspect`/`showroom.capture` (a scene screenshot/state dump for an agent to see what it
just did) are out of scope for the same reason plus one more: they would need a render-loop hook
(`VehicleCanvas.tsx` owns the `THREE.WebGLRenderer`/`WebGPURenderer`), which this module — kept
deliberately renderer-agnostic, holding no reference to any renderer or canvas — does not have
access to. `RenderController` (Priority 6) is the prerequisite, the same way `CameraController` was
the prerequisite for `camera.*`.

## The runtime remains usable without MCP

Nothing above requires an MCP server, a tool-call transport, or ACS to function — `VehicleCanvas`
could call `new VehicleSceneAgentApi(controller).mutate.setPaint(id)` directly today in place of
`controller.applyOption(controller.getOption(id))`, and every test exercises it exactly that way:
plain TypeScript calls, no protocol in between. That is the point — mission Non-Goal: *"expose
arbitrary eval or raw object mutation to agents"* is avoided not by adding an MCP-specific
permission layer on top, but by the capability surface itself never accepting or returning anything
an eval or a raw mutation could exploit.
