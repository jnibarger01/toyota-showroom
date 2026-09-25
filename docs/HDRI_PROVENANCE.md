# HDRI provenance

Environment maps for the paint-studio lighting presets (`HDRI_PRESETS`, `lib/data/paintStudio.ts`).
All are **CC0** from [Poly Haven](https://polyhaven.com/license) — public domain, no attribution
required; authors recorded anyway. Produced by `scripts/fetch-hdri.mjs`: the 1k (1024×512) source is
fetched, box-filtered to 512×256 in linear float, and re-encoded as RLE RGBE.

| Preset | File | Source | Author |
|---|---|---|---|
| `hdri-studio` (default) | `public/hdri/studio_small_09_512.hdr` | [Studio Small 09](https://polyhaven.com/a/studio_small_09) | Sergej Majboroda |
| `hdri-showroom` | `public/hdri/photo_studio_loft_hall_512.hdr` | [Photo Studio Loft Hall](https://polyhaven.com/a/photo_studio_loft_hall) | Sergej Majboroda |
| `hdri-overcast` | `public/hdri/kloofendal_overcast_puresky_512.hdr` | [Kloofendal Overcast (Pure Sky)](https://polyhaven.com/a/kloofendal_overcast_puresky) | Greg Zaal |
| `hdri-sunset` | `public/hdri/venice_sunset_512.hdr` | [Venice Sunset](https://polyhaven.com/a/venice_sunset) | Greg Zaal |

## Why 512×256

The maps drive reflections and image-based lighting only — `scene.background` stays the showroom
palette colour — so they are never viewed directly. 512 wide resolves a clearcoat's sharpest
reflection at showroom camera distances; the default preset is fetched on every builder visit, so
the 1k source's ~4× bytes would be a first-load cost for a difference visible only in close-up.

## What this replaced

`hdri-sunset` previously pointed at `cold_photography_studio_1k.hdr` — despite the name, a 128×64
studio capture — and the other three presets had no environment map at all.
