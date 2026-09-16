# 2025 Toyota Camry XV80 provenance

## Source asset

The showroom integration targets `public/models/camry/camry.glb`.
The supplied source asset is **2025 Toyota Camry (XV80) Hybrid** by **Ddiaz Design**:

- Sketchfab model: `53f8cbf2483940fba956f4e740a3a4ae`
- Source page: `https://sketchfab.com/3d-models/2025-toyota-camry-xv80-hybrid-53f8cbf2483940fba956f4e740a3a4ae`
- License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 (CC BY-NC-SA 4.0)
- Source description credits: `https://vk.com/free_3d_car_models` and Sketchfab user `@s122`; it states the work is based on a Toyota 3D model
- Supplied source size: 71,678,588 bytes
- Supplied source SHA-256: `c41f67906dde336a82e9c3b24b8742cdf8da358d8962591d9bced1a1ce9d50e5`
- Contract inspection: 1,194 nodes, 692 meshes, 70 materials, 30 embedded images/textures, 0 animations

The project owner states this repository/deployment is non-commercial and that the creator has authorized this use. Attribution and ShareAlike obligations remain attached to redistributed derivatives.

## Runtime optimization

The source GLB is intentionally not meant to ship at its original 68.4 MiB payload. `scripts/optimize-models.mjs` registers the Camry with `stripTextures: true`, matching the GR Supra's factors-only runtime policy while preserving authored node/material names used by showroom customization contracts.

The shipped runtime artifact was produced from the supplied source with the repository optimizer:

- Optimized size: 4,096,868 bytes (3.91 MiB; 94.3% smaller than source)
- Optimized SHA-256: `4dfabe47b99c995aa56d9b21845d6a9a91530427bd1fa48e04db1dc596b5ddc9`
- Resulting contract: 692 meshes, 70 materials, 0 embedded textures, 0 animations
- Payload budget: 5 MiB

The source remains preserved separately; the repository ships only the optimized derivative.
