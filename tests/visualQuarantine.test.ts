import { describe, expect, it } from "vitest";
import {
  findVisualQuarantine,
  ownerIssueNumber,
  visualQuarantine,
  type VisualQuarantineEntry,
} from "./e2e/visualQuarantine";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function daysSince(isoDate: string, now = new Date()): number {
  const then = new Date(`${isoDate}T00:00:00.000Z`);
  return Math.floor((now.getTime() - then.getTime()) / 86_400_000);
}

describe("visual quarantine registry (#48)", () => {
  it("declares a positive stable-pass threshold (exit after N green CI runs)", () => {
    expect(visualQuarantine.stablePassThreshold).toBeGreaterThanOrEqual(3);
  });

  it("declares a finite max quarantine window so flakes are not parked forever", () => {
    expect(visualQuarantine.maxQuarantineDays).toBeGreaterThan(0);
    expect(visualQuarantine.maxQuarantineDays).toBeLessThanOrEqual(180);
  });

  it("requires every entry to name a real owner issue and a dated reason", () => {
    for (const entry of visualQuarantine.entries) {
      assertEntryShape(entry);
      expect(
        ownerIssueNumber(entry.ownerIssue),
        `${entry.testTitle}: ownerIssue must be #N or a github.com/.../issues/N URL`,
      ).not.toBeNull();
      expect(entry.reason.trim().length).toBeGreaterThan(8);
      expect(entry.quarantinedOn).toMatch(ISO_DATE);
    }
  });

  it("rejects entries that have sat past maxQuarantineDays without being cleared", () => {
    const { maxQuarantineDays, entries } = visualQuarantine;
    const stale = entries.filter(
      (entry) => daysSince(entry.quarantinedOn) > maxQuarantineDays,
    );
    expect(
      stale,
      stale
        .map(
          (e) =>
            `${e.testTitle} quarantinedOn=${e.quarantinedOn} (owner ${e.ownerIssue}) — fix the flake, raise maxQuarantineDays only with a linked issue comment, or remove the entry`,
        )
        .join("\n") || undefined,
    ).toEqual([]);
  });

  it("looks up entries by exact Playwright test title", () => {
    expect(findVisualQuarantine("__does-not-exist__")).toBeUndefined();
    for (const entry of visualQuarantine.entries) {
      expect(findVisualQuarantine(entry.testTitle)).toEqual(entry);
    }
  });
});

describe("ownerIssueNumber", () => {
  it("parses #N, bare N, and github issue URLs", () => {
    expect(ownerIssueNumber("#48")).toBe("48");
    expect(ownerIssueNumber("48")).toBe("48");
    expect(
      ownerIssueNumber(
        "https://github.com/jnibarger01/toyota-showroom/issues/48",
      ),
    ).toBe("48");
  });

  it("rejects free-form text that is not an issue reference", () => {
    expect(ownerIssueNumber("see slack")).toBeNull();
    expect(ownerIssueNumber("")).toBeNull();
  });
});

function assertEntryShape(entry: VisualQuarantineEntry): void {
  expect(entry.testTitle.trim().length).toBeGreaterThan(0);
  expect(typeof entry.ownerIssue).toBe("string");
  expect(typeof entry.reason).toBe("string");
  expect(typeof entry.quarantinedOn).toBe("string");
}
