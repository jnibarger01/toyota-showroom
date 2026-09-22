import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ShareQrCard } from "../../app/components/ShareQrCard";

describe("ShareQrCard focus management", () => {
  it("focuses the close button and wraps Tab within the dialog", () => {
    render(<ShareQrCard url="https://example.test/?c=abc" onClose={() => undefined} />);

    const dialog = screen.getByTestId("share-qr-card");
    const close = screen.getByRole("button", { name: "Close QR share card" });

    expect(document.activeElement).toBe(close);

    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<ShareQrCard url="https://example.test/?c=abc" onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the opener when closed", () => {
    const onClose = vi.fn();
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    const returnFocusRef = { current: opener };
    const { unmount } = render(
      <ShareQrCard url="https://example.test/?c=abc" onClose={onClose} returnFocusRef={returnFocusRef} />,
    );

    unmount();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
