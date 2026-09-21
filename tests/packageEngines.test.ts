import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Keeps local Node, CI setup-node, and package.json engines on the same floor (#54).
 *
 * Sandboxes and contributor machines often default to Node 20 while Playwright/e2e and this
 * package already declare `>=22.13.0`. When those diverge, e2e "works in CI" and fails locally
 * (or the reverse) with no obvious engines signal. This suite asserts the pins stay aligned:
 * engines field, `.nvmrc`, workflow `node-version-file`, `.npmrc` engine-strict, and the
 * README / CONTRIBUTING docs that tell humans what to install.
 */

const ROOT = process.cwd();
const ENGINES_FLOOR = ">=22.13.0";
const NVMRC_FLOOR = "22.13";

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

function parseSemverTriplet(version: string): [number, number, number] {
  const match = version.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) {
    throw new Error(`not a semver-ish version: ${version}`);
  }
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/** True when `version` satisfies `>=22.13.0` (major.minor.patch compare). */
function satisfiesEnginesFloor(version: string): boolean {
  const [maj, min, pat] = parseSemverTriplet(version);
  const [fMaj, fMin, fPat] = parseSemverTriplet("22.13.0");
  if (maj !== fMaj) return maj > fMaj;
  if (min !== fMin) return min > fMin;
  return pat >= fPat;
}

describe("package engines alignment (#54)", () => {
  const pkg = JSON.parse(read("package.json")) as {
    engines?: { node?: string };
  };

  it("declares Node >=22.13.0 in package.json engines", () => {
    expect(pkg.engines?.node).toBe(ENGINES_FLOOR);
  });

  it("pins the same floor in .nvmrc for nvm/fnm/asdf/volta-friendly local use", () => {
    const nvmrc = read(".nvmrc").trim();
    expect(nvmrc).toBe(NVMRC_FLOOR);
    expect(satisfiesEnginesFloor(nvmrc)).toBe(true);
  });

  it("enables npm engine-strict so mismatched local Node fails install loudly", () => {
    const npmrc = read(".npmrc");
    expect(npmrc).toMatch(/^\s*engine-strict\s*=\s*true\s*$/m);
  });

  it("points every setup-node workflow at .nvmrc (not a looser major-only pin)", () => {
    const workflowsDir = path.join(ROOT, ".github/workflows");
    const files = readdirSync(workflowsDir).filter((name) => name.endsWith(".yml"));
    expect(files.length).toBeGreaterThan(0);

    const setupNodeFiles: string[] = [];
    for (const name of files) {
      const source = read(path.join(".github/workflows", name));
      if (!source.includes("actions/setup-node@")) continue;
      setupNodeFiles.push(name);
      expect(
        source,
        `${name}: expected node-version-file: .nvmrc so CI tracks the same floor as engines`,
      ).toMatch(/node-version-file:\s*\.nvmrc/);
      expect(
        source,
        `${name}: must not keep a separate node-version pin that can drift from .nvmrc`,
      ).not.toMatch(/^\s*node-version:\s*/m);
    }

    expect(setupNodeFiles.sort()).toEqual(
      [
        "ci.yml",
        "deploy-staging.yml",
        "e2e.yml",
        "pages.yml",
        "update-visual-snapshots.yml",
      ].sort(),
    );
  });

  it("documents the required Node version in README and CONTRIBUTING", () => {
    const readme = read("README.md");
    const contributing = read("CONTRIBUTING.md");
    expect(readme).toMatch(/Node\.js\s+`?>=?22\.13/);
    expect(readme).toMatch(/\.nvmrc/);
    expect(contributing).toMatch(/>=22\.13\.0/);
    expect(contributing).toMatch(/\.nvmrc/);
    expect(contributing).toMatch(/engine-strict/);
    expect(contributing).toMatch(/volta|asdf|fnm|nvm/i);
  });
});
