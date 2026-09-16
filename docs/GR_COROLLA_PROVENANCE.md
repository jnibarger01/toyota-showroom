# 2023 Toyota GR Corolla provenance

## Source asset

The showroom integration uses a user-supplied local asset:

- Source file: `/home/jacen/Downloads/2023_toyota_gr_corolla.glb`
- Source size: 20,142,488 bytes
- Source SHA-256: `47feb3fddd7d6253a7e251a28784e1b58487d6e6d6e55ae0503d46823f8476fc`
- glTF version: 2.0
- Contract inspection: 64 nodes, 44 meshes, 25 materials, 0 animations
- Authored material slots include `paint`, `roof`, `spoiler`, `mirror`, `rim_detail`, `calliper`, `lights`, `int_2`, and `material_21`.

The source author and license were not encoded in the repository context used for this integration, so this document does not assert ownership or a redistribution license. Repository owners should retain the source-side permission record separately.

## Runtime optimization

`scripts/optimize-models.mjs` registers the GR Corolla and preserves its node/material contract while applying the repository's existing dedup/prune/Draco pipeline.

- Runtime file: `public/models/gr-corolla-2023/2023_toyota_gr_corolla.glb`
- Optimized size: 3,815,072 bytes (3.64 MiB; 81.1% smaller)
- Optimized SHA-256: `7133af04aba9d53bf601382a2896d14df9830f954dc6f26fb4ab998be008f647`
- Payload budget: 5 MiB

## Explore thumbnail

`public/images/vehicles/gr-corolla/gr-corolla-front-three-quarter.png` is an 800x500 Blender studio render from the supplied GLB. The render uses the authored `paint` material with a red presentation color; it does not alter the runtime asset.