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
(13 tests, real fixture geometry, real material writes):

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

## What is deliberately not implemented yet, and why

The mission's example vocabulary also names `camera.setPreset`/`camera.focus`/`camera.orbit`,
`environment.setPreset`, `lighting.setPreset`, and `showroom.inspect`/`showroom.capture`. These are
**not** on `VehicleSceneAgentApi` today, because the state they would mutate does not live on
`VehicleSceneController` — camera preset, terrain, and environment preset are `VehicleCanvas`/
`BuilderApp` React props and `useState`, driven by GSAP tweens in `VehicleCanvas.tsx`'s effects, not
controller-owned scene state. Adding `camera.orbit()` here today would mean one of two dishonest
things: a method that silently does nothing (violates this codebase's own standard — see
`VehicleSceneController.applyOption`'s doc comment on why a no-op is treated as a bug, not a
graceful default), or reaching past this module into React component internals it has no business
touching (the opposite of the boundary Priority 6 asks for — configurator/application state and
scene/runtime state are supposed to stay separated, not have the "typed API" module quietly bridge
them by calling into a specific component's props).

`scene.focusPart` (implemented) is the deliberate seam for this: it returns the world-space
bounding sphere a camera controller needs to frame a part, computed from real geometry, without
this module owning or moving any camera. A camera-control capability layer — `CameraController`
alongside `VehicleSceneController`, likely owning the `OrbitControls`/preset-tween logic
`VehicleCanvas.tsx` currently keeps inline — is the natural next step once it exists to wrap
(**NEXT EVOLUTION**, not started here): at that point `camera.focus(id)` becomes
`agentApi.mutate.cameraFocus(id)` calling `cameraController.focus(agentApi.read.focusPart(id))`,
composing the two rather than either module reaching into the other's internals.

`showroom.inspect`/`showroom.capture` (a scene screenshot/state dump for an agent to see what it
just did) are out of scope for the same reason plus one more: they would need a render-loop hook
(`VehicleCanvas.tsx` owns the `THREE.WebGLRenderer`/`WebGPURenderer`), which this module — kept
deliberately renderer-agnostic, holding no reference to any renderer or canvas — does not have
access to.

## The runtime remains usable without MCP

Nothing above requires an MCP server, a tool-call transport, or ACS to function — `VehicleCanvas`
could call `new VehicleSceneAgentApi(controller).mutate.setPaint(id)` directly today in place of
`controller.applyOption(controller.getOption(id))`, and every test exercises it exactly that way:
plain TypeScript calls, no protocol in between. That is the point — mission Non-Goal: *"expose
arbitrary eval or raw object mutation to agents"* is avoided not by adding an MCP-specific
permission layer on top, but by the capability surface itself never accepting or returning anything
an eval or a raw mutation could exploit.
