# Toyota GT86 provenance

## Identity and source

The showroom integration uses the supplied local asset under its verified public identity, Toyota
GT86. It is not registered as a GR86 and does not duplicate any GR86 catalog entry.

- Source file: `/home/jacen/Downloads/toyota_gt86_3d_model_free.glb`
- Source size: 37,399,636 bytes
- Source SHA-256: `808eadc1618b08f79a478560cfbe5a03f1adf066abb924c0ed06bbb185fe0fc5`
- Title: `Toyota GT86 3D Model (Free)`
- Author: Mpgs.studio3DModels (`mpgs.studio` on Sketchfab)
- Source: https://sketchfab.com/3d-models/toyota-gt86-3d-model-free-ec05296ddf2f4c22a570512245d1fba0
- License: Creative Commons Attribution 4.0 International (`CC-BY-4.0`)
- glTF version: 2.0
- Contract inspection: 66 nodes, 64 meshes, 12 materials, 0 animations, 0 textures

These title, author, source, and license values are encoded in the source GLB's `asset.extras` and
were independently matched to the live Sketchfab API metadata. The source does not state a model
year. The catalog uses 2012, the first-generation launch year, as representative showroom metadata;
it is not asserted as the exact model year of the mesh.

CC-BY-4.0 permits sharing and adaptation, including commercial use, provided attribution and the
license notice are retained. Toyota names and marks remain subject to their respective trademark
rights; this asset license does not grant trademark ownership or imply Toyota endorsement.

## Runtime optimization

`scripts/optimize-models.mjs` preserves the named-node/material contract and embedded attribution
while applying the repository's existing dedup/prune/Draco pipeline.

- Runtime file: `public/models/gt86/toyota_gt86.glb`
- Runtime size: 2,988,996 bytes (2.85 MiB; 92.0% smaller)
- Runtime SHA-256: `9dd289c59b9157e8be83c4c058b37724509b0eb0a2e74769c96799223abb77be`
- Payload budget: 4 MiB
- Preserved materials include `body.001`, `glass.001`, `red.001`, and `silver.002`.

## Explore thumbnail

`public/images/vehicles/gt86/gt86-front-three-quarter.png` is captured from the production showroom
renderer using the committed optimized GLB and the model's default camera preset.
