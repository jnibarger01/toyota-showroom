# Reviewed GLB asset transfer

This PR adds reviewed local GLB files under `assets/imported/` so they can be pulled onto another development machine without changing the active showroom catalog.

## Blender import results

Each added file was imported successfully with Blender 5.2.0 LTS using the native glTF importer in a clean factory-startup session.

| Asset | Size | Mesh objects | Triangles | Materials | Textures | Animations | Assessment |
|---|---:|---:|---:|---:|---:|---:|---|
| `toyota-rav4-2024-lowpoly.glb` | 29,932 bytes | 24 | 1,480 | 8 | 0 external image files | 0 | Lightweight low-poly RAV4 asset |
| `toyota-rav4-showroom.glb` | 3,419,784 bytes | 215 | 218,008 | 16 | 0 external image files | 0 | Detailed RAV4 showroom asset |
| `trd-pro-wheel.glb` | 15,575,348 bytes | 26 | 169,348 | 5 | 0 external image files | 0 | Detailed standalone wheel asset |

The measured dimensions and source SHA-256 hashes are recorded below for transfer verification. Blender reported no import errors for these files.

## Provenance and merge note

- The source files were found locally and copied without geometry or material changes.
- The RAV4 assets are local generated/exported assets; no external source attribution was available in the files.
- The TRD Pro wheel's external license/provenance was not present in the local file inventory. Confirm that it is appropriate for publication in this public repository before merging this PR.
- These files are intentionally not wired into the runtime vehicle catalog in this asset-transfer PR.

## Integrity

| Asset | SHA-256 |
|---|---|
| `toyota-rav4-2024-lowpoly.glb` | `7a207f2a488e54a6e918175712b35302ddbc96867905f944cc9f14a1bd39a31e` |
| `toyota-rav4-showroom.glb` | `4028babbf74eb43ebee06280fcc4f8087d897c7c996c88bcf5a16be49aa6f2ef` |
| `trd-pro-wheel.glb` | `a229e20435dac8cfccb3e61eb36064633ae286b0bde50b230a4904d50071aacb` |

## Deliberately not copied

- Existing checked-in assets were not duplicated.
- `toyota_supra.glb` is byte-identical to the checked-in SaitoYang Supra asset.
- `toyota_gr_supra.glb` was not copied because the repository documentation identifies it as CC-BY-NC-4.0 and this repository has a public deployment.
- `toyota_supra (1).glb` was not copied because it is a near-duplicate with unverified provenance/license.
