import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  CANVAS_ERROR_BOUNDARY_COPY,
  CanvasErrorBoundary,
  classifyCanvasError,
} from "../../app/components/CanvasErrorBoundary";
import type { MediaAsset } from "../../lib/types/vehicle";

/**
 * Unlike `VehicleCanvas` itself — which needs a GPU and is stubbed out everywhere else — the
 * boundary is plain React and can be exercised for real. Worth doing: an error boundary that does
 * not catch is indistinguishable from no boundary at all right up until production, because the
 * happy path renders identically either way.
 */

const HERO: MediaAsset = { url: "/images/hero.png", alt: "2024 Toyota 4Runner" };

function Boom({ message = "WebGL adapter unavailable" }: { message?: string }): never {
  throw new Error(message);
}

/** React logs caught render errors to console.error; silenced so the suite output stays readable. */
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

describe("classifyCanvasError", () => {
  it("recognizes GPU / WebGL context-loss wording", () => {
    expect(classifyCanvasError(new Error("WebGL context lost"))).toBe("gpu");
    expect(classifyCanvasError(new Error("WEBGL_CONTEXT_LOST_WEBGL"))).toBe("gpu");
    expect(classifyCanvasError(new Error("No WebGPU adapter available"))).toBe("gpu");
    expect(classifyCanvasError(new Error("GPU device lost"))).toBe("gpu");
  });

  it("recognizes GLB / decode asset wording", () => {
    expect(classifyCanvasError(new Error("GLB decode failed"))).toBe("asset");
    expect(classifyCanvasError(new Error("Failed to load the model: network error"))).toBe("asset");
    expect(classifyCanvasError(new Error("Invalid glTF: missing buffers"))).toBe("asset");
    expect(classifyCanvasError(new Error("Draco decoder threw"))).toBe("asset");
  });

  it("falls back to generic when the cause is ambiguous", () => {
    expect(classifyCanvasError(new Error("Loading chunk 7 failed"))).toBe("generic");
    expect(classifyCanvasError(new Error("Cannot read properties of null"))).toBe("generic");
    expect(classifyCanvasError(null)).toBe("generic");
  });

  it("prefers GPU classification when both GPU and asset words appear", () => {
    // Recovery copy should blame the graphics layer when that is what failed.
    expect(classifyCanvasError(new Error("WebGL failed to decode texture"))).toBe("gpu");
  });
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

  it("explains GPU / context loss when the throw is distinguishable", () => {
    render(
      <CanvasErrorBoundary fallbackImage={HERO}>
        <Boom message="WebGL context lost" />
      </CanvasErrorBoundary>,
    );
    const fallback = screen.getByTestId("canvas-error-fallback");
    expect(fallback).toHaveAttribute("data-error-kind", "gpu");
    expect(screen.getByText(CANVAS_ERROR_BOUNDARY_COPY.gpu.title)).toBeInTheDocument();
    expect(screen.getByText(CANVAS_ERROR_BOUNDARY_COPY.gpu.body)).toBeInTheDocument();
  });

  it("explains asset failure when the throw is distinguishable", () => {
    render(
      <CanvasErrorBoundary fallbackImage={HERO}>
        <Boom message="GLB decode failed during scene mount" />
      </CanvasErrorBoundary>,
    );
    const fallback = screen.getByTestId("canvas-error-fallback");
    expect(fallback).toHaveAttribute("data-error-kind", "asset");
    expect(screen.getByText(CANVAS_ERROR_BOUNDARY_COPY.asset.title)).toBeInTheDocument();
    expect(screen.getByText(CANVAS_ERROR_BOUNDARY_COPY.asset.body)).toBeInTheDocument();
  });

  it("keeps generic copy when the cause is not distinguishable", () => {
    // The point of the fallback is that a 3D failure costs the viewport, not the configurator.
    // If the copy stops saying so, users reload or leave over a still-usable page.
    render(
      <CanvasErrorBoundary fallbackImage={HERO}>
        <Boom message="Loading chunk 12 failed" />
      </CanvasErrorBoundary>,
    );
    expect(screen.getByTestId("canvas-error-fallback")).toHaveAttribute("data-error-kind", "generic");
    expect(screen.getByText(CANVAS_ERROR_BOUNDARY_COPY.generic.title)).toBeInTheDocument();
    expect(screen.getByText(/configuration option below still works/i)).toBeInTheDocument();
  });

  it("keeps GPU and asset titles distinct from each other and from generic", () => {
    expect(CANVAS_ERROR_BOUNDARY_COPY.gpu.title).not.toEqual(CANVAS_ERROR_BOUNDARY_COPY.asset.title);
    expect(CANVAS_ERROR_BOUNDARY_COPY.gpu.title).not.toEqual(CANVAS_ERROR_BOUNDARY_COPY.generic.title);
    expect(CANVAS_ERROR_BOUNDARY_COPY.asset.title).not.toEqual(CANVAS_ERROR_BOUNDARY_COPY.generic.title);
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
