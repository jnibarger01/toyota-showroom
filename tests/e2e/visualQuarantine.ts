/**
 * Visual-spec flake quarantine helpers (#48).
 *
 * Known flakes are registered in `visual-quarantine.json` with an owner GitHub
 * issue — never a silent `test.skip` / `test.fixme` with no tracker. A
 * quarantined title is marked `fixme` so CI stays informative (reported as
 * skipped/fixme, not silently absent), and the unit gate in
 * `tests/visualQuarantine.test.ts` rejects entries that lack an owner issue
 * or that have sat past `maxQuarantineDays` without being fixed or removed.
 *
 * Exit criteria (also in CONTRIBUTING.md): after the underlying flake is fixed,
 * remove the entry once the spec has been green for `stablePassThreshold`
 * consecutive e2e CI runs on `main` (or keep it un-quarantined and watch those
 * runs before deleting the issue). Do not leave a fixme parked forever.
 */
import quarantine from "./visual-quarantine.json" with { type: "json" };

export type VisualQuarantineEntry = {
  /** Exact Playwright test title as passed to `test(...)`. */
  testTitle: string;
  /** Full URL or `#NNN` / `NNN` form of the tracking issue. */
  ownerIssue: string;
  reason: string;
  /** ISO date `YYYY-MM-DD` when the entry was added. */
  quarantinedOn: string;
};

export type VisualQuarantineRegistry = {
  stablePassThreshold: number;
  maxQuarantineDays: number;
  entries: VisualQuarantineEntry[];
};

export const visualQuarantine = quarantine as VisualQuarantineRegistry;

export function findVisualQuarantine(
  testTitle: string,
): VisualQuarantineEntry | undefined {
  return visualQuarantine.entries.find((entry) => entry.testTitle === testTitle);
}

/**
 * Resolve an ownerIssue field to a comparable issue number string, or null if
 * the value is not a recognizable GitHub issue reference.
 */
export function ownerIssueNumber(ownerIssue: string): string | null {
  const trimmed = ownerIssue.trim();
  const hashOnly = /^#?(\d+)$/.exec(trimmed);
  if (hashOnly) return hashOnly[1];
  const fromUrl = /github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/i.exec(trimmed);
  if (fromUrl) return fromUrl[1];
  return null;
}

/**
 * Mark the current test fixme when its title is in the quarantine registry.
 * Call at the top of a visual test body with Playwright's conditional fixme:
 * `applyVisualQuarantine(title, (condition, description) => test.fixme(condition, description))`.
 */
export function applyVisualQuarantine(
  testTitle: string,
  fixme: (condition: boolean, description: string) => void,
): void {
  const entry = findVisualQuarantine(testTitle);
  if (!entry) return;
  const issueRef = ownerIssueNumber(entry.ownerIssue) ?? entry.ownerIssue;
  fixme(
    true,
    `Quarantined visual flake — tracked in #${issueRef}: ${entry.reason}`,
  );
}
