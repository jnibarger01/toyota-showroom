# GR Supra and shared wheel provenance

## Toyota GR Supra

The shipped model is the supplied `/home/jacen/Downloads/toyota_gr_supra.glb`, copied without recompression to `public/models/gr-supra-2024/toyota_gr_supra.glb`.

- SHA-256: `39436feea760a5ad94374203a45a1a253384e89c4d1fab6cab76b9c800d1be9d`
- Size: 16,792,184 bytes
- Contract inspection: 232 nodes, 94 meshes, 28 materials, 34 textures, 0 animations
- Thumbnail: `public/images/vehicles/gr-supra/gr-supra-thumbnail.webp`, 800x500, rendered from this GLB by `scripts/render-thumbnails.ts` with the catalog's "Factory wheels" finish applied (the asset's `Wheel1A` has no base colour). It contains no UI.

## TRD Pro wheel

`public/models/4runner-2024/wheel_trd_pro.glb` is the supplied asset (SHA-256 `a229e20435dac8cfccb3e61eb36064633ae286b0bde50b230a4904d50071aacb`). It is registered once in `lib/data/wheels.ts` and exposed only for the verified 4Runner four-mount contract. The existing 4Runner tire assembly is preserved.

## Bugatti wheel source

`bugatti_wheel_free_download.zip` was inspected in a temporary directory outside the repository (SHA-256 `14130f708182a68a0971e801d5d7877152d1f481ac695f0de2d590dbaf2ed5bc`). It contains a single wheel mesh (`bugatti_wheel_low_Chiron_wheelsShdr_0`) with one material and three 2K textures; no tire geometry or four-wheel authored assembly was present. The source license is CC-BY-4.0, by tulex_art, from Sketchfab model `71618eba5db5478e963fc5df0808b0d6`. It remains unshipped and has no verified vehicle compatibility; the registry fails closed and does not expose it.
