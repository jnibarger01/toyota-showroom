# Agent-authorable scene API

`lib/agent/sceneApi.ts`'s `VehicleSceneAgentApi` is the typed local boundary a future governed MCP
adapter would expose to Hermes/Codex-style agents — designed once the runtime API it sits on
(`VehicleSceneController` + `SceneRegistry`) was stable, but **not** wired to MCP itself. Mission
Non-Goals: *"Do not create an MCP layer before the runtime API is stable"* and *"MCP is an adapter,
not the authority"* — this module is the authority; an MCP server built later is a thin transport
translating each capability below to a tool call and back.

(The priority numbers cited throughout this document — Priority 3 through 6 — are the P1–P8
sequence from the mission's RAV4-integration continuation: P1 production RAV4 integration, P3
`CameraController`, P4 wiring `camera.*` onto this module, P5 `EnvironmentController`, P6
`RenderController`. `VehicleSceneController`/`SceneRegistry`/picking and this module itself predate
that sequence — foundational work from earlier in the mission — so they are named without a P-number
here rather than reused against a scheme they were not built under.)

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
`three-mesh-bvh` picking — no stubs, all covered by `tests/agentSceneApi.test.ts`
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
just did) are out of scope for the same reason as `environment.*`, now that the prerequisite exists:
`RenderController` (`lib/three/renderController.ts`, Priority 6) is real today and owns exactly the
render-loop hook this would need — a live renderer/canvas reference this module deliberately does
not hold — including a real `capture()` method (`HTMLCanvasElement.toDataURL`, fails closed to
`null` for a zero-sized or tainted canvas). As with `environment.*`, no mission priority has asked
for that composition yet, so it is not on `VehicleSceneAgentApi`. Wiring it in later is the same
shape again: an optional fourth constructor argument (`RenderController`), fail-closed when absent.
`showroom.inspect` has an easier path than `showroom.capture` once someone asks for it — most of
what it would report (parts, selection, hover) already exists on `read.scene.inspect`; only a
render-loop-derived addition (frame stats, capture) would need `RenderController` at all.

## The runtime remains usable without MCP

Nothing above requires an MCP server, a tool-call transport, or ACS to function — `VehicleCanvas`
could call `new VehicleSceneAgentApi(controller).mutate.setPaint(id)` directly today in place of
`controller.applyOption(controller.getOption(id))`, and every test exercises it exactly that way:
plain TypeScript calls, no protocol in between. That is the point — mission Non-Goal: *"expose
arbitrary eval or raw object mutation to agents"* is avoided not by adding an MCP-specific
permission layer on top, but by the capability surface itself never accepting or returning anything
an eval or a raw mutation could exploit.

## MCP-readiness checklist

Mission Priority 8: documentation only — nothing below is implemented, and building it is out of
scope until a mission priority asks for it, the same standard `environment.*`/`showroom.*` are held
to above. This is what "the runtime API is stable enough for an MCP layer" (the condition the
mission's own Non-Goal names) cashes out to, concretely, so building the adapter later is a checklist
against known shapes rather than a fresh design pass:

1. **Tool listing is `AGENT_CAPABILITIES`, unchanged.** One MCP tool per entry; `name` is the tool
   name (dotted today — `camera.setPreset` — collapse to whatever separator the chosen transport
   requires, e.g. `camera_setPreset`, at the adapter boundary, not in this module); `description`
   carries over as the tool's description. `kind` is exactly the read/mutate split Design Rule 3
   already keys a blanket policy on ("reads always allowed; mutations need authorization") — an
   MCP-side ACS wrapper branches on the same field, not a new one invented for MCP.
2. **Per-tool JSON Schema is generated from the existing TypeScript types, never hand-authored.**
   Design Rules 1 and 2 already guarantee every read returns a plain serializable type
   (`PartSummary`, `SceneInspection`, `FocusTarget`, `CameraStateSummary`, `CameraPresetSummary`,
   `CameraPose`) and every mutation accepts only an opaque catalog id or a primitive (a string id, a
   number delta) — exactly the input/output shapes a type-to-JSON-Schema generator needs and nothing
   a human has to redesign. `MutationResult` (`{ ok: true } | { ok: false; reason: string }`) is the
   uniform return shape for every `mutate.*` tool.
3. **A mutation failure is tool output, not a protocol error.** `{ ok: false, reason: "unknown
   option id ..." }` is a successful tool call carrying a business-logic result the caller needs to
   see — it must map to a normal (non-`isError`) MCP tool result whose content is that JSON, the same
   way this module returns it to a direct TypeScript caller today. Reserve actual MCP/JSON-RPC
   protocol errors for what this module cannot even attempt: an unknown tool name, a malformed
   call — never for a validation failure this module already turned into a typed result.
4. **Authorization is the transport's job, not this module's.** `VehicleSceneAgentApi` has no
   concept of a caller identity today and should not gain one for MCP's sake — Design Rule 3's
   read/mutate split is the hook an ACS policy (or any other gate) attaches to from outside, in the
   adapter, before a call reaches this module at all.
5. **Session binding is the open question an implementation has to answer first, not something this
   document resolves.** One `VehicleSceneAgentApi` instance wraps one loaded scene — one
   `VehicleSceneController`, optionally one `CameraController` — for as long as that browser tab's
   scene is alive. An MCP server co-located with the tab it serves (a companion extension, a
   same-process bridge) maps onto that 1:1 with no new design. An MCP server agents connect to
   independent of any live browser tab would need server-side scene state and, for
   `showroom.capture`, headless rendering — a materially larger undertaking this checklist
   deliberately does not scope, because no mission priority has asked for it.
6. **The adapter adds a transport, never a capability.** Every constraint above the checklist
   already holds — no raw `THREE.Object3D`, no node/material names, no asset URLs, no eval — carries
   over unchanged. If a future capability needs a wider surface than `AGENT_CAPABILITIES` currently
   grants, that is a change to this module first (with its own tests, the same as every capability
   above), never something bolted onto the transport layer to work around what this module
   deliberately does not expose.
