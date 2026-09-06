import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Keeps large binaries out of the git object database.
 *
 * This repository accumulated ~90 MB of Blender sources (a 33 MB `.blend` and a 57 MB `.glb`)
 * that no build step, test, or deploy ever read — every clone and every CI run paid for them.
 * They are untracked as of `FINAL_ASSET_MANIFEST.md`'s "Source assets" section, and
 * `.gitattributes` routes future binary sources to LFS.
 *
 * That routing is inert until LFS is actually enabled on the remote, which is exactly the window
 * where the mistake recurs: someone commits a new authoring file, it looks fine locally, and it is
 * permanently in history before anyone notices. So the enforcement lives here instead — this test
 * reads what git has staged and fails on anything oversized, whether or not LFS is
 * configured. An LFS-tracked file is a ~130-byte pointer blob in git, so it passes naturally.
 */

/**
 * Files git is tracking, as `[path, blobByteSize]`.
 *
 * Reads the *index* rather than `HEAD` so a staged `git rm --cached` or a staged oversized file is
 * reflected before the commit exists — running the suite pre-commit should tell you what you are
 * about to commit, not what you last committed. CI checks out a commit, where index and `HEAD`
 * agree, so the stricter local behavior costs nothing there.
 *
 * Sizes come from the blob in the object database, not from `stat` on the working tree. That is
 * the number that matters for clone weight, and it is also what makes this correct under LFS: an
 * LFS-tracked file is a ~130-byte pointer blob in git while being the full-size file on disk.
 */
function trackedFileSizes(): Array<[string, number]> {
  const index = execFileSync("git", ["ls-files", "--stage"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  // <mode> SP <object> SP <stage> TAB <path>
  const entries: Array<{ sha: string; path: string }> = [];
  for (const line of index.split("\n")) {
    if (!line) continue;
    const [meta, path] = line.split("\t");
    if (!path) continue;
    const sha = meta.trim().split(/\s+/)[1];
    // Skip gitlinks (submodule commits), which have no blob to size.
    if (meta.trim().startsWith("160000")) continue;
    entries.push({ sha, path });
  }

  // One `cat-file --batch-check` for the whole index; per-file `git` spawns would dominate runtime.
  const sizes = execFileSync("git", ["cat-file", "--batch-check=%(objectsize)"], {
    input: entries.map((entry) => entry.sha).join("\n"),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean)
    .map(Number);

  if (sizes.length !== entries.length) {
    throw new Error(`git cat-file returned ${sizes.length} sizes for ${entries.length} index entries`);
  }
  return entries.map((entry, index_) => [entry.path, sizes[index_]]);
}

const MiB = 1024 * 1024;

/**
 * Default ceiling for any tracked file. Set at 2 MiB because that is comfortably above everything
 * this project legitimately ships — the largest is the hero GLB at ~1.2 MiB — while being far
 * below the scale of the sources this guard exists to keep out.
 */
const DEFAULT_BUDGET_BYTES = 2 * MiB;

/**
 * Files allowed past the default, each with the reason it earns the exception. An entry here is a
 * deliberate decision to ship those bytes; adding one should be as considered as raising a budget
 * in `tests/glbContract.test.ts`.
 */
const ALLOWANCES: Record<string, { bytes: number; why: string }> = {
  "public/renders/rav4-2024/rav4_2024_limited_buffers.base64": {
    bytes: 6 * MiB,
    why: "Base64 capture data for the RAV4 render pipeline; not fetched by the running app.",
  },
  "public/models/4runner-limited.gltf": {
    bytes: 5 * MiB,
    why: "Uncompressed fallback 4Runner catalog asset.",
  },
  "public/renders/rav4-2024/rav4_2024_limited_decoded.bin": {
    bytes: 4 * MiB,
    why: "Decoded RAV4 geometry retained beside its capture metadata.",
  },
  "package-lock.json": {
    bytes: 4 * MiB,
    why: "Lockfile; text, and required to be committed.",
  },
  "design-concept.png": {
    bytes: 3 * MiB,
    why: "Approved design reference image.",
  },
};

describe("git object database weight", () => {
  const tracked = trackedFileSizes();

  it("tracks no file over its budget", () => {
    const over = tracked
      .filter(([path, size]) => size > (ALLOWANCES[path]?.bytes ?? DEFAULT_BUDGET_BYTES))
      .map(([path, size]) => `${path} (${(size / MiB).toFixed(1)} MiB)`)
      .sort();

    expect(
      over,
      `These tracked files exceed their size budget. Binary *source* assets (.blend, .fbx, .psd, ` +
        `raw captures) do not belong in git — untrack them and record their retrieval SHAs in ` +
        `FINAL_ASSET_MANIFEST.md, or enable Git LFS so .gitattributes can route them. Raise a ` +
        `budget only for something the app genuinely ships.`,
    ).toEqual([]);
  });

  it("no longer tracks the Blender sources that were untracked deliberately", () => {
    // Named explicitly rather than left to the size rule: these two are the reason this file
    // exists, and re-adding them is the specific regression worth a message of its own.
    const paths = new Set(tracked.map(([path]) => path));
    for (const path of [
      "assets/blender/modsnation_7416_assets_assembled_final.blend",
      "assets/blender/modsnation_7416_assets_assembled_final.glb",
    ]) {
      expect(
        paths.has(path),
        `${path} is tracked again. It is ~89 MB of authoring input that nothing in the build ` +
          `reads; see FINAL_ASSET_MANIFEST.md for how to retrieve it from history instead.`,
      ).toBe(false);
    }
  });

  it("keeps every allowance pointed at a file that still exists", () => {
    // Otherwise allowances outlive their files and quietly become permission for a future,
    // unrelated file at the same path.
    const paths = new Set(tracked.map(([path]) => path));
    const stale = Object.keys(ALLOWANCES).filter((path) => !paths.has(path));
    expect(stale, "Remove allowances for files that are no longer tracked.").toEqual([]);
  });
});
