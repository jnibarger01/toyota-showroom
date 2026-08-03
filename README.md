# 4Runner WebGPU Builder — Build 7416 Assembled Asset

This project integrates the uploaded `modsnation_7416_assets_assembled.glb` as the primary vehicle asset.

## Stack

- Next.js / React
- vinext
- Three.js WebGPU renderer with WebGL2 fallback
- GSAP
- Tailwind CSS
- Lucide icons
- Drizzle ORM / Cloudflare D1 schema

## Integrated model

- File: `public/models/modsnation_7416_assets_assembled.glb`
- Size: approximately 57 MB
- 69 geometry objects
- Approximately 591,604 triangles
- Includes body, placed wheels/tires, front and rear brakes, grille, headlights, taillights, exhaust, logo, and materials
- Vehicle paint material: `body.carmain`

The runtime does not add duplicate replacement wheels. Paint, camera, lift, and procedural accessory controls remain available.

## Run

```bash
npm install
npx next dev -p 3004
```

Open `http://127.0.0.1:3004/`.

## Final packaged assets

This package includes the authoritative Blender source, final exported GLB, and approved hero render. See `FINAL_ASSET_MANIFEST.md`.
