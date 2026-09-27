import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { VehicleSpin } from "../../app/components/VehicleSpin";
import type { ExteriorSpin } from "../../lib/types/spin";

function makeSpin(id = "spin-a", paintCode = "040"): ExteriorSpin {
  return {
    id,
    schemaVersion: "1.0.0",
    vehicleSlug: "rav4-hybrid",
    modelYear: 2023,
    gradeId: "xle",
    paintCode,
    frameCount: 24,
    degreesPerFrame: 15,
    zeroAngle: "front",
    direction: "clockwise",
    width: 1600,
    height: 1000,
    source: { kind: "render" },
    frames: Array.from({ length: 24 }, (_, index) => ({
      url: `/spins/${paintCode}/${String(index).padStart(2, "0")}.webp`,
      alt: `frame ${index}`,
      width: 1600,
      height: 1000,
    })),
  };
}

describe("VehicleSpin", () => {
  it("rotates by one frame with the arrow keys and Home returns to front", () => {
    render(<VehicleSpin spin={makeSpin()} vehicleLabel="2023 Toyota RAV4 Hybrid" onRequest3D={() => {}} />);
    const viewer = screen.getByTestId("vehicle-spin");
    fireEvent.keyDown(viewer, { key: "ArrowRight" });
    expect(screen.getByRole("img")).toHaveAttribute("alt", expect.stringContaining("15 degrees"));
    fireEvent.keyDown(viewer, { key: "Home" });
    expect(screen.getByRole("img")).toHaveAttribute("alt", expect.stringContaining("0 degrees"));
  });

  it("preserves the viewing angle when paint changes", () => {
    const { rerender } = render(
      <VehicleSpin spin={makeSpin("spin-a", "040")} vehicleLabel="2023 Toyota RAV4 Hybrid" onRequest3D={() => {}} />,
    );
    const viewer = screen.getByTestId("vehicle-spin");
    fireEvent.keyDown(viewer, { key: "ArrowRight" });
    fireEvent.keyDown(viewer, { key: "ArrowRight" });
    expect(screen.getByRole("img")).toHaveAttribute("alt", expect.stringContaining("30 degrees"));

    rerender(
      <VehicleSpin spin={makeSpin("spin-b", "1G3")} vehicleLabel="2023 Toyota RAV4 Hybrid" onRequest3D={() => {}} />,
    );
    expect(screen.getByRole("img")).toHaveAttribute("alt", expect.stringContaining("30 degrees"));
    expect(screen.getByRole("img")).toHaveAttribute("src", "/spins/1G3/02.webp");
  });

  it("uses the poster when a frame fails to load", () => {
    render(
      <VehicleSpin
        spin={makeSpin()}
        vehicleLabel="2023 Toyota RAV4 Hybrid"
        posterUrl="/poster.webp"
        onRequest3D={() => {}}
      />,
    );
    const image = screen.getByRole("img");
    fireEvent.error(image);
    expect(image).toHaveAttribute("src", "/poster.webp");
  });

  it("hands off to the 3D renderer only when requested", () => {
    const onRequest3D = vi.fn();
    render(
      <VehicleSpin
        spin={makeSpin()}
        vehicleLabel="2023 Toyota RAV4 Hybrid"
        onRequest3D={onRequest3D}
      />,
    );
    fireEvent.click(screen.getByTestId("explore-in-3d"));
    expect(onRequest3D).toHaveBeenCalledTimes(1);
  });
});