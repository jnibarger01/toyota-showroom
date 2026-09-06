import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CanvasErrorBoundary } from "../../app/components/CanvasErrorBoundary";
import type { MediaAsset } from "../../lib/types/vehicle";

/**
 * Unlike `VehicleCanvas` itself — which needs a GPU and is stubbed out everywhere else — the
 * boundary is plain React and can be exercised for real. Worth doing: an error boundary that does
 * not catch is indistinguishable from no boundary at all right up until production, because the
 * happy path renders identically either way.
 */

const HERO: MediaAsset = { url: "/images/hero.png", alt: "2024 Toyota 4Runner" };

function Boom(): never {
  throw new Error("WebGL adapter unavailable");
}

/** React logs caught render errors to console.error; silenced so the suite output stays readable. */
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

describe("CanvasErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(
      <CanvasErrorBoundary fallbackImage={HERO}>
        <div data-testid="scene" />
      </CanvasErrorBoundary>,
    );
    expect(screen.getByTestId("scene")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the vehicle's hero render instead of the failed scene", () => {
    render(
      <CanvasErrorBoundary fallbackImage={HERO}>
        <Boom />
      </CanvasErrorBoundary>,
    );

    const image = screen.getByAltText(HERO.alt);
    expect(image).toHaveAttribute("src", HERO.url);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("tells the user the rest of the page still works", () => {
    // The point of the fallback is that a 3D failure costs the viewport, not the configurator.
    // If the copy stops saying so, users reload or leave over a still-usable page.
    render(
      <CanvasErrorBoundary fallbackImage={HERO}>
        <Boom />
      </CanvasErrorBoundary>,
    );
    expect(screen.getByText(/configuration option below still works/i)).toBeInTheDocument();
  });

  it("degrades to the notice alone when a vehicle has no hero image", () => {
    render(
      <CanvasErrorBoundary>
        <Boom />
      </CanvasErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("reports the error to the host", () => {
    const onError = vi.fn();
    render(
      <CanvasErrorBoundary fallbackImage={HERO} onError={onError}>
        <Boom />
      </CanvasErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0]![0] as Error).message).toBe("WebGL adapter unavailable");
  });

  it("recovers when the underlying failure has cleared", () => {
    // The realistic case: a chunk fetch fails mid-deploy and succeeds once the deploy settles.
    //
    // The failing condition is an external flag the test flips, not a render counter. React
    // recovers from an error thrown during concurrent rendering by re-rendering the whole root
    // synchronously, so the component is invoked more than once per attempt and any "fail the
    // first N renders" scheme is consumed by React's own retry rather than by the user's.
    let chunkAvailable = false;
    function Flaky() {
      if (!chunkAvailable) throw new Error("transient chunk load failure");
      return <div data-testid="scene" />;
    }

    render(
      <CanvasErrorBoundary fallbackImage={HERO}>
        <Flaky />
      </CanvasErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    chunkAvailable = true;
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(screen.getByTestId("scene")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("returns to the fallback when a retry fails again", () => {
    render(
      <CanvasErrorBoundary fallbackImage={HERO}>
        <Boom />
      </CanvasErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
