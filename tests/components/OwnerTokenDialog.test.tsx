import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
