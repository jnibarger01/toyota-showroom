# Final Asset Manifest

## Runtime asset

- `public/models/modsnation_7416_assets_assembled.glb`
  - Latest assembled 4Runner GLB used by the WebGPU/Three.js viewer.
  - ~1.2 MiB, Draco-compressed and pruned by `scripts/compress-glb.mjs`.
  - Optimized from a 28.1 MiB export: ~18 MiB of undrivable morph targets and ~6.5 MiB of
    unreferenced bufferViews removed, with every node name, every material name, and the rendered
    triangle count preserved. `tests/glbContract.test.ts` holds the size budget.

## Source assets — in history, not in the working tree

Both files below are **untracked from `HEAD`** and listed in `.gitignore`. Nothing in the build,
test, or deploy path reads them; they are Blender authoring inputs whose only downstream consumer
is the runtime GLB above, which *is* committed. Removing them from the working tree keeps a fresh
checkout ~89 MB lighter.

They were not purged from history, so they remain fully retrievable at the SHAs below. A history
rewrite is the only thing that would reclaim the clone-size cost, and it force-pushes `main` and
invalidates every existing clone — a deliberate, coordinated operation, not a cleanup.

| File | Blob SHA | Size | SHA-256 |
| --- | --- | --- | --- |
| `assets/blender/modsnation_7416_assets_assembled_final.blend` | `d1256fee5b6357b225b7326e9372d2a8bbccf616` | 33,124,711 B | `c8d7b008342be5feb314f7c526cf74d56f09c17b51d63a030e03892510ab060c` |
| `assets/blender/modsnation_7416_assets_assembled_final.glb` | `1f6e8ca1aa78cb2cae133c0b92cf2d24c4337775` | 59,711,828 B | `bdfd68592b2e25bd0693da28046c6a7b2624ac6c186c03cb7fc2a53bd15d89e0` |

Both were introduced in commit `3838363a3552ce25a5edfca8bc93d8cea7a80344` (2026-08-03).

### Retrieving them

```bash
mkdir -p assets/blender

git cat-file -p d1256fee5b6357b225b7326e9372d2a8bbccf616 \
  > assets/blender/modsnation_7416_assets_assembled_final.blend

git cat-file -p 1f6e8ca1aa78cb2cae133c0b92cf2d24c4337775 \
  > assets/blender/modsnation_7416_assets_assembled_final.glb

# Verify before trusting either file as an authoring source.
sha256sum -c <<'SUMS'
c8d7b008342be5feb314f7c526cf74d56f09c17b51d63a030e03892510ab060c  assets/blender/modsnation_7416_assets_assembled_final.blend
bdfd68592b2e25bd0693da28046c6a7b2624ac6c186c03cb7fc2a53bd15d89e0  assets/blender/modsnation_7416_assets_assembled_final.glb
SUMS
```

A shallow clone (`--depth=1`, which is what CI does) will not have these blobs. Run
`git fetch --unshallow` first.

### Adding new binary sources

`.gitattributes` routes `*.blend`, `*.fbx`, `*.psd`, `*.hdr`, and `*.exr` to Git LFS. That routing
is inert until LFS is enabled — `git lfs install` locally, and LFS turned on for the repository —
so **enable LFS before committing a new binary source**, or it lands in the object database at
full size exactly as these two did.

`tests/repoWeight.test.ts` is the actual enforcement: it fails CI on any tracked file over its
budget whether or not LFS is configured.

## Reference image

- `public/images/modsnation_7416_final_hero_tweaked.png`
  - Final approved Blender hero render (~0.9 MiB).

The application code continues to load `/models/modsnation_7416_assets_assembled.glb`.
