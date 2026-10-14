# GR Corolla provenance

The shipped model is the user-supplied `2023_toyota_gr_corolla.glb` (uploaded in the session that
added it), optimized by `scripts/optimize-models.mjs` to
`public/models/gr-corolla-2023/gr-corolla.glb`.

- Source SHA-256: `47feb3fddd7d6253a7e251a28784e1b58487d6e6d6e55ae0503d46823f8476fc`
- Source size: 20,142,488 bytes (19.21 MiB), generator `Sketchfab-0.3.0`, uncompressed
- Shipped size: 1.19 MiB — Draco (edgebreaker) + dedup + prune, then a second pass that
  WebP-encodes the textures (the 2048² glass normal is capped at 1024, quality 93) and simplifies
  non-paint meshes under a 0.05% error bound. Paint, roof, and spoiler triangles are left intact.
  `texturePolicy` stays `preserve`. Low tier loads `gr-corolla.lod1.glb` (~0.25 MiB).
- Contract: 64 nodes, 44 meshes, 25 materials, 3 textures, 0 animations, ~183k triangles on the
  full asset (was ~482k; the paint primitive stays ~17k). Every node and material name is preserved.
- **License / author: not recorded in the file.** Node names (`desirefx.me_014.*`) suggest a
  desirefx.me-distributed source. Confirm the license permits redistribution before a public deploy.

## Runtime transform

Authored along X at ~18.9 units for a 4.38 m car. `lib/data/vehicles/gr-corolla.ts` applies
`scale: 0.231` and a 90° yaw so the nose faces −z like the rest of the catalog; confirmed in the
rendered thumbnail.

## Customization targets

Mesh names are generic, so options pin to the mesh carrying the named material:

| Part | Meshes | Material |
|---|---|---|
| Body paint | `Object_7` | `paint` |
| Roof | `Object_8` | `roof` |
| Rear spoiler | `Object_12` | `spoiler` |
| Rims | `Object_29`, `Object_42`, `Object_50`, `Object_58` | `material_18` |
| Brake calipers | `Object_4`, `Object_46`, `Object_54`, `Object_62` | `calliper` |

Paint and rim targets were verified visually (option applied in a render). Caliper targets are
verified by material name only; they are not visible from the thumbnail angle.
