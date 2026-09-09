import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ValidatedLeadForm } from "../../app/components/ValidatedLeadForm";

afterEach(() => {
  vi.unstubAllGlobals();
});

function fillValidLeadForm(): void {
  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Jamie Customer" } });
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "jamie@example.com" } });
  fireEvent.change(screen.getByLabelText(/how can we help/i), {
    target: { value: "I would like more information about this vehicle." },
  });
}

describe("ValidatedLeadForm", () => {
  it("does not report success when the default lead backend is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));

    render(<ValidatedLeadForm />);
    fillValidLeadForm();
    fireEvent.click(screen.getByRole("button", { name: /send request/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/could not send|was not sent|try again/i);
    });

    expect(screen.queryByText(/thanks — your request was sent/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toHaveValue("Jamie Customer");
    expect(screen.getByLabelText(/email/i)).toHaveValue("jamie@example.com");
  });
});
