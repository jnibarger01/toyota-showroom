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

function acceptedLeadResponse(): Response {
  return new Response(
    JSON.stringify({
      data: {
        id: "lead_test123",
        kind: "contact",
        name: "Jamie Customer",
        email: "jamie@example.com",
        message: "I would like more information about this vehicle.",
        createdAt: "2026-09-09T23:00:00.000Z",
      },
    }),
    { status: 201, headers: { "Content-Type": "application/json" } },
  );
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

  it("uses the real lead API by default and sends an idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(acceptedLeadResponse());
    vi.stubGlobal("fetch", fetchMock);

    render(<ValidatedLeadForm />);
    fillValidLeadForm();
    fireEvent.click(screen.getByRole("button", { name: /send request/i }));

    await screen.findByText(/thanks — your request was sent/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/leads$/);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      kind: "contact",
      name: "Jamie Customer",
      email: "jamie@example.com",
      message: "I would like more information about this vehicle.",
    });
    expect(body.idempotencyKey).toMatch(/^lead-submit_/);
  });

  it("does not show success until an injected submit authority actually resolves", async () => {
    let resolveSubmit: (() => void) | undefined;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }),
    );

    render(<ValidatedLeadForm onSubmit={onSubmit} />);
    fillValidLeadForm();
    fireEvent.click(screen.getByRole("button", { name: /send request/i }));

    expect(screen.getByRole("button", { name: /sending/i })).toBeDisabled();
    expect(screen.queryByText(/thanks — your request was sent/i)).not.toBeInTheDocument();

    resolveSubmit?.();
    await screen.findByText(/thanks — your request was sent/i);
  });

  it("renders a safe retryable error when a configured submit authority rejects", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("provider detail must not leak"));

    render(<ValidatedLeadForm onSubmit={onSubmit} />);
    fillValidLeadForm();
    fireEvent.click(screen.getByRole("button", { name: /send request/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not send|was not sent|try again/i);
    expect(alert).not.toHaveTextContent(/provider detail/i);
    expect(screen.getByRole("button", { name: /send request/i })).toBeEnabled();
    expect(screen.getByLabelText(/how can we help/i)).toHaveValue(
      "I would like more information about this vehicle.",
    );
  });

  it("turns an API rejection into failure instead of treating any fetch response as accepted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "rate_limited", status: 429, message: "Slow down." } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    render(<ValidatedLeadForm />);
    fillValidLeadForm();
    fireEvent.click(screen.getByRole("button", { name: /send request/i }));

    await screen.findByRole("alert");
    expect(screen.queryByText(/thanks — your request was sent/i)).not.toBeInTheDocument();
  });
});
