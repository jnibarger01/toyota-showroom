import { describe, expect, it } from "vitest";
import {
  DEFAULT_CURRENCY_CODE,
  DEFAULT_CURRENCY_LOCALE,
  formatCurrency,
  formatPriceDelta,
} from "../lib/shared/currency";

describe("formatCurrency", () => {
  it("documents the default locale and currency assumption", () => {
    expect(DEFAULT_CURRENCY_LOCALE).toBe("en-US");
    expect(DEFAULT_CURRENCY_CODE).toBe("USD");
  });

  it("formats whole-dollar MSRP with en-US grouping and a $ symbol", () => {
    expect(formatCurrency(50_700)).toBe("$50,700");
    expect(formatCurrency(0)).toBe("$0");
  });

  it("formats USD using an explicit locale", () => {
    const expected = new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(50_700);

    expect(formatCurrency(50_700, { locale: "de-DE" })).toBe(expected);
  });

  it("rounds half away from zero at the configured fraction digits", () => {
    // Default sticker display is whole dollars.
    expect(formatCurrency(579.5)).toBe("$580");
    expect(formatCurrency(579.4)).toBe("$579");
    expect(formatCurrency(1_234.5)).toBe("$1,235");
    // Explicit cents — Intl rounds 1.005 → $1.01, 1.015 → $1.02 under en-US.
    expect(formatCurrency(1.005, { minimumFractionDigits: 2, maximumFractionDigits: 2 })).toBe("$1.01");
    expect(formatCurrency(1.015, { minimumFractionDigits: 2, maximumFractionDigits: 2 })).toBe("$1.02");
  });

  it("formats negative absolute amounts with a leading minus (not a plus)", () => {
    expect(formatCurrency(-425)).toBe("-$425");
  });
});

describe("formatPriceDelta", () => {
  it("prefixes positive option deltas with +", () => {
    expect(formatPriceDelta(1_150)).toBe("+$1,150");
    expect(formatPriceDelta(425)).toBe("+$425");
  });

  it("formats negative deltas with a single minus (not +$-N)", () => {
    expect(formatPriceDelta(-425)).toBe("-$425");
    expect(formatPriceDelta(-1_150.4)).toBe("-$1,150");
    expect(formatPriceDelta(-1_150.5)).toBe("-$1,151");
  });

  it("leaves zero unsigned", () => {
    expect(formatPriceDelta(0)).toBe("$0");
  });

  it("keeps the sign when using an explicit locale", () => {
    const expected = new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
      signDisplay: "exceptZero",
    }).format(1_150);

    expect(formatPriceDelta(1_150, { locale: "de-DE" })).toBe(expected);
    expect(formatPriceDelta(1_150, { locale: "de-DE" })).toMatch(/^\+/);
  });
});
