# RAV4 Hybrid and Land Cruiser model provenance

This integration adds two distinct catalog records and does not replace the existing 2024 `rav4`
record. The runtime files are optimized derivatives of user-supplied GLBs. The raw sources remain
outside the repository.

| Vehicle | Source file | Source SHA-256 | Runtime file | Runtime SHA-256 |
| --- | --- | --- | --- | --- |
| 2023 Toyota RAV4 Hybrid | `2023_toyota_rav4_hybrid.glb` (21,950,532 bytes) | `27108903f71c73ee1819aaa1688779e1d091a034ceb3ea405c3e1325e71da01b` | `public/models/rav4-hybrid-2023/rav4-hybrid.glb` (4,828,076 bytes) | `c8add6a54c23575f6240d247e0b7b9e7d663f9fcba6866793d1518188110b95e` |
| 2025 Toyota Land Cruiser 250 | `2025_toyota_land_cruiser_250.glb` (75,432,380 bytes) | `b2a0d27905a621984a1275e3d65f3065d1e2b7e437f450ab0850a9f707f08cd1` | `public/models/land-cruiser-250-2025/land-cruiser-250.glb` (7,730,312 bytes) | `140424217afacb3f202ee3ae2732fd59b2a6ab36513be2088135a629d0b5012e` |

Both raw GLBs contain the following embedded attribution metadata, which is retained in the
optimized runtime derivatives:

- Author: Ddiaz Design (`https://sketchfab.com/ddiaz-design`)
- License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
- RAV4 source: `https://sketchfab.com/3d-models/2023-toyota-rav4-hybrid-ed155ad0cb7d447085a519eaff9aa2df`
- Land Cruiser source: `https://sketchfab.com/3d-models/2025-toyota-land-cruiser-250-b53e78d5e3474474a788e7ef4deccda0`
- License: `https://creativecommons.org/licenses/by-nc-sa/4.0/`

The supplied assets were optimized with glTF-Transform 4.4.2 and Draco mesh compression. Node and
material names, texture content, scene hierarchy, and embedded attribution metadata were retained;
unused mesh records were pruned. The runtime files therefore count as modified derivatives for
license-notice purposes.

## Redistribution constraint

CC BY-NC-SA 4.0 permits sharing and adaptation only under its conditions. It requires attribution,
a link to the license, an indication of changes, noncommercial use, and ShareAlike distribution of
adapted material. This repository has no independently verified commercial-use permission from the
author. These two model files must not be used for a commercial deployment unless separate rights
are obtained. Other rights, including Toyota trademarks and design rights, may also require
permission; the Creative Commons license does not establish those rights.

The Sketchfab pages returned HTTP 403 during the 2026-09-17 verification pass. The title, author,
source URL, and license facts above were therefore verified directly from the embedded `asset.extras`
objects in both raw GLBs and again in both runtime derivatives, rather than inferred from filenames.

## Geometry and runtime normalization

- RAV4 Hybrid runtime bounds before normalization: 0.02128 m wide, 0.01695 m high, 0.04596 m long.
  `Vehicle3DConfig.scale = [100, 100, 100]` restores a vehicle-sized 2.13 × 1.70 × 4.60 m scene.
- Land Cruiser runtime bounds before centering: 2.114 × 1.922 × 4.928 m. It uses unit scale.
- Shared `prepareVehicleRoot()` logic centers and grounds both vehicles from `Sketchfab_model`.
  Camera presets are vehicle data; no model-specific UI or loader branch was added.
