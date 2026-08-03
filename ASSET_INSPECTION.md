# Asset inspection

## Selected source

`modsnation_7416_assets_assembled.glb` was selected over `modsnation_7416_assets_wheels_placed.glb`.

| Asset | Size | Geometry objects | Triangles | Assessment |
|---|---:|---:|---:|---|
| assembled | 57 MB | 69 | 591,604 | Most complete; selected |
| wheels placed | 54 MB | 53 | 529,910 | Leaner but contains fewer assembled components |

## Scene contents observed

- `BODY`
- `Tun_GRILLE`
- `DEFAULT_HEADLIGHTS`
- `DEFAULT_TAILLIGHTS`
- `FRONT_BRAKES`
- `REAR_BRAKES`
- `EXHAUST`
- `LOGO`
- Four `MOUNT_WHEEL_*` nodes
- Placed wheel, tire, and caliper assemblies

## Material support

The asset uses clearcoat, emissive strength, specular, and index-of-refraction glTF material extensions. The vehicle paint is exposed as `body.carmain`, which the configurator updates at runtime.

## Runtime behavior

- WebGPU attempted first
- WebGL2 fallback retained
- Draco loader remains configured for compatibility
- Existing assembled wheels are preserved
- Procedural wheel injection is disabled to prevent duplicates
