import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  CANVAS_MODEL_STATUS_COPY,
  CanvasModelStatus,
} from "../../app/components/CanvasModelStatus";

/**
 * Plain presentational overlay — no GPU. Worth a cheap suite so empty vs error copy and the
 * Retry CTA cannot drift apart from the acceptance for #75 (forced GLB 404 → retry CTA).
 */

describe("CanvasModelStatus", () => {
  it("renders distinct empty copy without a retry control", () => {
    render(<CanvasModelStatus kind="empty" />);

    const status = screen.getByTestId("canvas-model-status");
    expect(status).toHaveAttribute("data-kind", "empty");
    expect(status).toHaveAttribute("role", "status");
    expect(screen.getByText(CANVAS_MODEL_STATUS_COPY.empty.title)).toBeInTheDocument();
    expect(screen.getByText(CANVAS_MODEL_STATUS_COPY.empty.body)).toBeInTheDocument();
    expect(screen.queryByTestId("canvas-model-retry")).not.toBeInTheDocument();
  });

  it("renders distinct error copy with a retry CTA", () => {
    const onRetry = vi.fn();
    render(<CanvasModelStatus kind="error" onRetry={onRetry} />);

    const status = screen.getByTestId("canvas-model-status");
    expect(status).toHaveAttribute("data-kind", "error");
    expect(status).toHaveAttribute("role", "alert");
    expect(screen.getByText(CANVAS_MODEL_STATUS_COPY.error.title)).toBeInTheDocument();
    expect(screen.getByText(CANVAS_MODEL_STATUS_COPY.error.body)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps empty and error titles distinct from the React error-boundary copy", () => {
    // Guard against collapsing #75 into #58: the boundary's generic title stays out of this overlay.
    render(
      <>
        <CanvasModelStatus kind="empty" />
        <CanvasModelStatus kind="error" onRetry={() => {}} />
      </>,
    );
    expect(screen.queryByText(/interactive view unavailable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/graphics view interrupted/i)).not.toBeInTheDocument();
    expect(CANVAS_MODEL_STATUS_COPY.empty.title).not.toEqual(CANVAS_MODEL_STATUS_COPY.error.title);
  });
});
