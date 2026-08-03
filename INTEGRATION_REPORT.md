# Blender inspection and WebGPU integration report

## Inspected files

### `4runner-limited.blend`
- Decompressed Blender file size: ~82 MB.
- Contains the complete high-detail 2024 Toyota 4Runner Limited body, BFGoodrich KO3 tires, WEISU wheels, build camera, studio lights, wheel mounting points, license-plate mounting points, exhaust sound mount, materials, and build metadata.
- This is the best primary editable Blender source among the three files.

### `ModsNation_7416_full_build.blend1`
- Decompressed Blender file size: ~124 MB.
- Contains the same high-detail vehicle data plus duplicate `.001` objects and duplicate mount nodes.
- Useful as a recovery/alternate full-build source, but less clean for direct editing because of duplicated objects.

### `4runner-limited.blend1`
- Decompressed Blender file size: ~5.7 MB.
- Contains a much smaller procedural/stylized build with many separate wheel-spoke and amber-light objects.
- It is not the primary high-detail vehicle source.

## Integrated browser asset

`public/models/4runner-limited.gltf` is the supplied Blender-exported glTF 2.0 asset. It includes:

- Blender glTF exporter metadata (`Khronos glTF Blender I/O v3.6.28`)
- Inline binary geometry and embedded JPEG textures
- `KHR_draco_mesh_compression`
- `KHR_materials_clearcoat`
- `KHR_materials_emissive_strength`
- Body paint, chrome, glass, plastic, fog-light, brake-light, and turn-signal materials
- Named wheel, license-plate, and exhaust mounting nodes

## Runtime integration

`VehicleCanvas.tsx` now:

1. Attempts native Three.js WebGPU rendering.
2. Falls back to WebGL2 if WebGPU initialization fails.
3. Loads the high-detail Draco-compressed glTF.
4. Uses the four wheel mount nodes for runtime wheels.
5. Keeps paint, lift, roof rack, light bar, sliders, camera presets, and wheel-style controls functional.
6. Falls back to simple procedural geometry only if the glTF cannot load.

## Draco decoder

The loader currently uses Google's hosted Draco decoder. This requires internet access on the first load. For a fully offline build, copy the Draco decoder files into `public/draco/` and change `setDecoderPath()` to `/draco/`.
