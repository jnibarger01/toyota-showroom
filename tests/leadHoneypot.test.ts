import { describe, expect, it } from "vitest";
import {
  isLeadHoneypotTriggered,
  isSuspiciouslyFastLeadSubmit,
  shouldSilentlyDropLeadClient,
  stripLeadHoneypotField,
} from "../lib/validation/leadHoneypot";

describe("lead honeypot helpers", () => {
  it("triggers on non-empty companyWebsite and strips the field", () => {
    const body = { name: "A", companyWebsite: " https://spam.test " };
    expect(isLeadHoneypotTriggered(body)).toBe(true);
    expect(stripLeadHoneypotField(body)).toEqual({ name: "A" });
  });

  it("does not trigger on empty or missing honeypot", () => {
    expect(isLeadHoneypotTriggered({ name: "A" })).toBe(false);
    expect(isLeadHoneypotTriggered({ name: "A", companyWebsite: "  " })).toBe(false);
    expect(isLeadHoneypotTriggered({ name: "A", companyWebsite: "" })).toBe(false);
  });

  it("treats non-string honeypot values as triggered", () => {
    expect(isLeadHoneypotTriggered({ companyWebsite: 1 })).toBe(true);
  });

  it("flags suspiciously fast submits", () => {
    expect(isSuspiciouslyFastLeadSubmit(1_000, 1_200, 800)).toBe(true);
    expect(isSuspiciouslyFastLeadSubmit(1_000, 2_000, 800)).toBe(false);
  });

  it("drops on the client for honeypot or fast dwell", () => {
    expect(
      shouldSilentlyDropLeadClient({
        companyWebsite: "x",
        mountedAtMs: 0,
        nowMs: 10_000,
      }),
    ).toBe(true);
    expect(
      shouldSilentlyDropLeadClient({
        companyWebsite: "",
        mountedAtMs: 1_000,
        nowMs: 1_100,
        minMs: 800,
      }),
    ).toBe(true);
    expect(
      shouldSilentlyDropLeadClient({
        companyWebsite: "",
        mountedAtMs: 1_000,
        nowMs: 2_000,
        minMs: 800,
      }),
    ).toBe(false);
  });
});
