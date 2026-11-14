# Toyota Showroom v2 — Vehicle-first Studio

Status: opt-in experience, available from the **Showroom v2** button on each builder route.
Scope: presentation and existing catalog controls. Does not replace Build & Price.

## Design reference

Adapts the uploaded interactive 3D car viewer's product-display hierarchy:
large vehicle stage, automotive-specification strip, factory paint swatches,
camera presets, and a technical controls panel.

The reference's Honda model and embedded assets **are not copied** into Toyota
Showroom. Existing Toyota GLBs and their provenance remain unchanged.

## What ships

- A responsive, light-surface showroom with the car given most of the screen.
- Factory color choices via the existing `CustomizationButton` state, hover preview,
  selection persistence, and paint-history hooks.
- Paint finish chips and wheel/tire options from the **vehicle's actual catalog**;
  procedural-preview wheels remain explicitly labeled as previews.
- Model-specific camera presets, persisting the chosen camera into the existing
  configuration state and cancelling an active cinematic tour on manual selection.
- Scene-only stance preview; feature hotspots, dimension labels, modeled doors,
  driver's eye view, and vehicle lighting only when supported by the loaded asset.
- Data-derived specification strip; no invented performance claims.
- One-click return to the full builder, advanced paint studio, or wheel catalog.

## What is intentionally not claimed

- **X-ray and exploded view:** not available unless the vehicle's underlying scene
  provides independently addressable body/interior/engine assemblies and reversible
  material/transform controls. A cosmetic alpha hack is not a real cross-section.
- **Authored wheel accuracy:** procedural packages can preview size/fitment, but are
  not claimed to match factory wheels.
- **Missing vehicle assets:** the catalog remains truthful; no generic placeholder is
  presented as a production-accurate Tacoma, AE86, or other model.
- **Reference asset license:** this PR changes no third-party GLB and imports none.
- **White-default materials:** some shipped GLBs lost their textures at build time
  (GR Supra, Camry — `scripts/optimize-models.mjs` `stripTextures`), so materials whose
  color lived only in a texture default to white: the Supra's wheel assemblies, grilles,
  interior and engine, the Camry's chrome, mirrors and decals. The catalog repairs exactly
  those materials with `materialColorFallbacks` (applied by `prepareVehicleRoot` only when
  a named material is textureless and still white — see `lib/three/materialColorFallbacks.ts`
  and `tests/materialColorFallbacks.test.ts`). A fallback is a flat color, not the authored
  texture: it fixes the white, it does not restore tread, lettering or grille detail. The
  long-term fix is the asset-quality gate below, re-authoring or re-sourcing those GLBs.

## Acceptance checks

1. `npm run typecheck`, `npm test`, `npm run lint`, and `npm run build` pass.
2. Load 4Runner, Supra, GR Corolla, and Land Cruiser, enter Showroom v2, orbit/zoom,
   switch cameras, then return to Build & Price without losing the build.
3. Select a factory paint and a wheel option; verify the existing builder and saved
   configuration reflect the selection. Check paint preview on mouse/focus.
4. Check dimensions, hotspots, doors, driver view, and lighting only on models whose
   GLB supports them. Confirm unavailable controls are absent, not falsely active.
5. Verify desktop and narrow mobile layout, keyboard focus, color contrast, and
   reduced-motion experience.

## Next slice

Create an asset-quality gate for all supported Toyota models: documented GLB source
and license, real-world dimensions and wheelbase, geometry/material maps, model-specific
orthographic comparisons, and deterministic visual baselines. Only after a pass should
X-ray or exploded technical views be enabled.
