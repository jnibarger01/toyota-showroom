import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { COMPARE_DEEP_LINK_BROKEN_COPY, CompareDeepLinkError } from "../../app/components/CompareDeepLinkError";

/**
 * The unrestorable-`?cmp=` recovery alert is a product-critical UX surface. Its copy must cover
 * both transport corruption and stale catalog references without leaking validation jargon.
 * Behavior tests cover both actions; the alert container itself is asserted via role/testid because styling hooks
 * (`.compare-deeplink-error`) and the a11y `role="alert"` live there.
 */

describe("COMPARE_DEEP_LINK_BROKEN_COPY", () => {
  it("pins the recovery copy", () => {
    expect(COMPARE_DEEP_LINK_BROKEN_COPY.title).toBe("This compare link can’t be restored");
    expect(COMPARE_DEEP_LINK_BROKEN_COPY.body).toBe(
      "The link may be incomplete, damaged, or refer to vehicle or option data that is no longer available. Ask for a new link, or start a fresh vehicle comparison below.",
    );
    expect(COMPARE_DEEP_LINK_BROKEN_COPY.resetLabel).toBe("Clear link and compare vehicles");
    expect(COMPARE_DEEP_LINK_BROKEN_COPY.dismissLabel).toBe("Dismiss");
  });

  it("never leaks internal validation-jargon into the recovery copy", () => {
    const combined = Object.values(COMPARE_DEEP_LINK_BROKEN_COPY).join(" ");
    // The exact class of raw message this alert replaces (lib/showroom/compareDeepLink.ts).
    expect(combined).not.toMatch(/base64url|JSON object|schema version|payload/);
    expect(combined).toMatch(/incomplete|damaged/);
    expect(combined).toMatch(/no longer available/);
  });
});

describe("CompareDeepLinkError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders as an alert with pinned copy and both actions", () => {
    render(<CompareDeepLinkError onReset={() => {}} onDismiss={() => {}} />);

    const alert = screen.getByTestId("compare-deeplink-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveClass("compare-deeplink-error");
    expect(screen.getByText(COMPARE_DEEP_LINK_BROKEN_COPY.title)).toBeInTheDocument();
    expect(screen.getByText(COMPARE_DEEP_LINK_BROKEN_COPY.body)).toBeInTheDocument();

    expect(screen.getByTestId("compare-deeplink-reset")).toHaveTextContent(
      COMPARE_DEEP_LINK_BROKEN_COPY.resetLabel,
    );
    expect(screen.getByTestId("compare-deeplink-dismiss")).toHaveTextContent(
      COMPARE_DEEP_LINK_BROKEN_COPY.dismissLabel,
    );
  });

  it("invokes onReset when the reset CTA is pressed", () => {
    const onReset = vi.fn();
    const onDismiss = vi.fn();
    render(<CompareDeepLinkError onReset={onReset} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByTestId("compare-deeplink-reset"));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("invokes onDismiss when dismiss is pressed", () => {
    const onReset = vi.fn();
    const onDismiss = vi.fn();
    render(<CompareDeepLinkError onReset={onReset} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByTestId("compare-deeplink-dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onReset).not.toHaveBeenCalled();
  });
});
