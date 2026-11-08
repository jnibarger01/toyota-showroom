// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { ShowroomV2Panel } from "../app/components/ShowroomV2Panel";
import { fourRunner } from "../lib/data/vehicles/4runner";
import { tacoma } from "../lib/data/vehicles/tacoma";
import type { CustomizationOption } from "../lib/types/customization";

vi.mock("../app/components/CustomizationButton", () => ({
  CustomizationButton: ({
    option,
    onBeforeSelect,
  }: {
    option: CustomizationOption;
    onBeforeSelect?: () => void;
  }) => <button type="button" onClick={onBeforeSelect}>{option.label}</button>,
}));

type Props = ComponentProps<typeof ShowroomV2Panel>;

function defaults(): Props {
  return {
    vehicle: fourRunner,
    cameraPresets: fourRunner.threeDConfig.cameraPresets,
    activePresetId: fourRunner.threeDConfig.cameraPresets[0]!.id,
    onCameraChange: vi.fn(),
    paintOptions: [],
    finishOptions: [],
    wheelOptions: [],
    paintMode: "oem",
    onBeforePaintChange: vi.fn(),
    onBeforeWheelChange: vi.fn(),
    onEditCategory: vi.fn(),
    lift: 0,
    onLiftChange: vi.fn(),
    showHotspots: false,
    hotspotsAvailable: false,
    onToggleHotspots: vi.fn(),
    showDimensions: false,
    onToggleDimensions: vi.fn(),
    doorsAvailable: false,
    doorsOpen: false,
    onToggleDoors: vi.fn(),
    driverViewAvailable: false,
    driverView: false,
    onToggleDriverView: vi.fn(),
    lampModes: [],
    lampMode: "modeled",
    onLampModeChange: vi.fn(),
    onExit: vi.fn(),
  };
}

describe("Toyota Showroom v2 panel", () => {
  it("uses only real catalog camera presets, without fabricating technical controls", () => {
    const props = defaults();
    render(<ShowroomV2Panel {...props} />);
    const cameraGroup = screen.getByRole("group", { name: "Camera views" });
    const cameraButtons = cameraGroup.querySelectorAll("button");
    expect(cameraButtons).toHaveLength(props.cameraPresets.length);
    fireEvent.click(cameraButtons[1]!);
    expect(props.onCameraChange).toHaveBeenCalledWith(props.cameraPresets[1]);
    expect(screen.queryByRole("button", { name: /x-ray|exploded/i })).toBeNull();
  });

  it("routes scene inspection to existing state callbacks", () => {
    const props = {
      ...defaults(),
      hotspotsAvailable: true,
      doorsAvailable: true,
      driverViewAvailable: true,
    };
    render(<ShowroomV2Panel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Feature hotspots/ }));
    fireEvent.click(screen.getByRole("button", { name: /Dimensions/ }));
    fireEvent.click(screen.getByRole("button", { name: /Open doors/ }));
    fireEvent.click(screen.getByRole("button", { name: /Driver's view/ }));
    fireEvent.click(screen.getByRole("button", { name: "2 in" }));
    expect(props.onToggleHotspots).toHaveBeenCalledTimes(1);
    expect(props.onToggleDimensions).toHaveBeenCalledTimes(1);
    expect(props.onToggleDoors).toHaveBeenCalledTimes(1);
    expect(props.onToggleDriverView).toHaveBeenCalledTimes(1);
    expect(props.onLiftChange).toHaveBeenCalledWith(2);
  });

  it("keeps paint and wheel selections on the existing history-backed option path", () => {
    const paint: CustomizationOption = {
      id: "test-red",
      category: "paint",
      label: "Rally Red",
      operation: "material-update",
      compatibleVehicleIds: ["4runner"],
      materialConfig: { color: "#aa0011" },
    };
    const wheel: CustomizationOption = {
      id: "test-wheel",
      category: "wheels",
      label: "Forged Preview",
      operation: "material-update",
      compatibleVehicleIds: ["4runner"],
    };
    const props = { ...defaults(), paintOptions: [paint], wheelOptions: [wheel] };
    render(<ShowroomV2Panel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Rally Red" }));
    fireEvent.click(screen.getByRole("button", { name: "Forged Preview" }));
    expect(props.onBeforePaintChange).toHaveBeenCalledTimes(1);
    expect(props.onBeforeWheelChange).toHaveBeenCalledTimes(1);
  });

  it("returns to the builder and provides access to the full paint editor", () => {
    const props = defaults();
    render(<ShowroomV2Panel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Full paint studio" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to builder" }));
    expect(props.onEditCategory).toHaveBeenCalledWith("paint");
    expect(props.onExit).toHaveBeenCalledTimes(1);
  });

  it("does not claim an authored GLB exists for the model-less Tacoma", () => {
    const props = { ...defaults(), vehicle: tacoma };
    render(<ShowroomV2Panel {...props} />);
    expect(screen.getByText(/No authored 3D model published/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /open doors/i })).toBeNull();
  });
});
