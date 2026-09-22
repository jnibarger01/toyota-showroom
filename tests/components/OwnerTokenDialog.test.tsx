import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OWNER_TOKEN_DIALOG_COPY, OwnerTokenDialog } from "../../app/components/OwnerTokenDialog";

/**
 * Targeted coverage for #80 / #31 — one-time owner-token dialog copy and dismiss warn.
 * Does not mount BuilderApp.
 */

describe("OWNER_TOKEN_DIALOG_COPY", () => {
  it("pins title, recovery hint, and dismiss warning", () => {
    expect(OWNER_TOKEN_DIALOG_COPY.title).toBe("Save your owner token");
    expect(OWNER_TOKEN_DIALOG_COPY.recoveryHint).toMatch(/lose this token/i);
    expect(OWNER_TOKEN_DIALOG_COPY.dismissWarn).toMatch(/not copied or downloaded/i);
  });
});

describe("OwnerTokenDialog", () => {
  it("renders the raw token once with copy and recovery hint", () => {
    render(
      <OwnerTokenDialog
        configurationId="cfg-1"
        ownerToken="secret-token-value"
        onDismiss={() => undefined}
      />,
    );

    const dialog = screen.getByTestId("owner-token-dialog");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(screen.getByTestId("owner-token-value")).toHaveTextContent("secret-token-value");
    expect(screen.getByTestId("owner-token-recovery-hint")).toHaveTextContent(
      OWNER_TOKEN_DIALOG_COPY.recoveryHint,
    );
    expect(screen.getByTestId("owner-token-copy")).toHaveTextContent(OWNER_TOKEN_DIALOG_COPY.copyLabel);
  });

  it("warns on dismiss when the token was not copied or downloaded", () => {
    const onDismiss = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(
      <OwnerTokenDialog configurationId="cfg-1" ownerToken="secret-token-value" onDismiss={onDismiss} />,
    );

    fireEvent.click(screen.getByTestId("owner-token-dismiss"));
    expect(confirm).toHaveBeenCalledWith(OWNER_TOKEN_DIALOG_COPY.dismissWarn);
    expect(onDismiss).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByTestId("owner-token-dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    confirm.mockRestore();
  });
});


describe("OwnerTokenDialog focus management", () => {
  it("focuses Copy first and wraps Tab and Shift+Tab within the dialog", () => {
    render(
      <OwnerTokenDialog configurationId="cfg-1" ownerToken="secret-token-value" onDismiss={() => undefined} />,
    );

    const close = screen.getByRole("button", { name: "Close owner token dialog" });
    const copy = screen.getByTestId("owner-token-copy");
    const download = screen.getByTestId("owner-token-download");
    const dismiss = screen.getByTestId("owner-token-dismiss");

    expect(document.activeElement).toBe(copy);

    dismiss.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(dismiss);

    expect(download).toBeInTheDocument();
  });

  it("dismisses on Escape after the token is secured", async () => {
    const onDismiss = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <OwnerTokenDialog configurationId="cfg-1" ownerToken="secret-token-value" onDismiss={onDismiss} />,
    );

    fireEvent.click(screen.getByTestId("owner-token-copy"));
    await waitFor(() => expect(screen.getByTestId("owner-token-copy")).toHaveTextContent(OWNER_TOKEN_DIALOG_COPY.copiedLabel));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("uses the dismiss confirmation on Escape when the token is unsecured", () => {
    const onDismiss = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(
      <OwnerTokenDialog configurationId="cfg-1" ownerToken="secret-token-value" onDismiss={onDismiss} />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(confirm).toHaveBeenCalledWith(OWNER_TOKEN_DIALOG_COPY.dismissWarn);
    expect(onDismiss).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    confirm.mockRestore();
  });
});
