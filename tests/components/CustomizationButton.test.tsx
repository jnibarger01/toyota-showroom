import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { CustomizationOption, VehicleConfiguration } from "../../lib/types/customization";
import type { VehicleSceneController } from "../../lib/three/sceneController";

/**
 * `configurationStore.selectOption` ends every successful click in `queueFlush()`, a debounced
 * write through `lib/api/configurations.ts`. Mocked here the same way `tests/storeConcurrency.test.ts`
 * mocks it — this file cares about the button's own rendering and click-dispatch behaviour, not
 * persistence, and a real `fetch` call escaping a jsdom test is exactly the kind of flake this
 * avoids.
 */
vi.mock("../../lib/api/configurations", () => ({
  async updateConfiguration(configurationId: string, input: { selections?: unknown }) {
    return {
      configurationId,
      vehicleId: "4runner",
      modelYear: 2024,
      model: "4Runner",
      gradeId: "trd-pro",
      selections: input.selections ?? {},
      revision: 2,
      schemaVersion: "1.0.0",
      createdAt: "",
      updatedAt: new Date().toISOString(),
    };
  },
}));

const { configurationStore } = await import("../../lib/state/configurationStore");
const { CustomizationButton } = await import("../../app/components/CustomizationButton");

/**
 * Never actually resolves nodes against a scene — deliberately, so this file's assertions are
 * about the button and the store's selection bookkeeping, not `VehicleSceneController`'s own
 * node-resolution correctness (already exhaustively covered by `tests/sceneController.test.ts`).
 */
const fakeController = {
  applyOption: async () => true,
  removeOption: async () => true,
  applyConfiguration: async () => ({ applied: [], failed: [] }),
} as unknown as VehicleSceneController;

function baseConfiguration(selections: VehicleConfiguration["selections"] = {}): VehicleConfiguration {
  return {
    configurationId: "cfg-1",
    vehicleId: "4runner",
    modelYear: 2024,
    model: "4Runner",
    gradeId: "trd-pro",
    selections,
    revision: 1,
    schemaVersion: "1.0.0",
    createdAt: "",
    updatedAt: "",
  };
}

const paint: CustomizationOption = {
  id: "paint-218-blueprint",
  category: "paint",
  label: "Blueprint",
  operation: "material-update",
  targetNodes: ["BODY"],
  targetMaterials: ["body.carmain"],
  materialConfig: { color: "#1558d6" },
  compatibleVehicleIds: ["4runner"],
};

const roofRack: CustomizationOption = {
  id: "accessory-roof-rack",
  category: "accessory",
  label: "Overland Roof Rack",
  operation: "mesh-visibility",
  targetNodes: ["ACCESSORY_ROOF_RACK"],
  priceDelta: 1150,
  compatibleVehicleIds: ["4runner"],
};

async function attach(selections: VehicleConfiguration["selections"] = {}, catalog: CustomizationOption[] = [paint, roofRack]) {
  await configurationStore.attachScene(fakeController, baseConfiguration(selections), catalog);
}

beforeEach(() => {
  configurationStore.reset();
});

afterEach(() => {
  configurationStore.reset();
});

describe("CustomizationButton", () => {
  it("renders a chip with its label and price, unselected by default", async () => {
    await attach();
    render(<CustomizationButton option={roofRack} />);

    const button = screen.getByRole("button", { name: /overland roof rack/i });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).not.toHaveClass("active");
    expect(screen.getByText("+$1,150")).toBeInTheDocument();
  });

  it("renders a swatch using the option's material colour, not its label text", async () => {
    await attach();
    render(<CustomizationButton option={paint} variant="swatch" />);

    const button = screen.getByRole("button", { name: "Blueprint" });
    expect(button).toHaveStyle({ background: "#1558d6" });
    expect(screen.queryByText("Blueprint")).not.toBeInTheDocument();
  });

  it("reflects the store's selection state as aria-pressed and the active class", async () => {
    await attach({ paint: [paint.id] });
    render(<CustomizationButton option={paint} variant="swatch" />);

    const button = screen.getByRole("button", { name: "Blueprint" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveClass("active");
  });

  it("clicking dispatches configurationStore.selectOption and the click is reflected back as selected", async () => {
    await attach();
    render(<CustomizationButton option={roofRack} />);

    const button = screen.getByRole("button", { name: /overland roof rack/i });
    fireEvent.click(button);

    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));
    expect(configurationStore.getSnapshot().configuration?.selections.accessory).toEqual([roofRack.id]);
  });

  it("disables the button while its own selection is pending, not while any other one is", async () => {
    await attach();
    render(
      <>
        <CustomizationButton option={paint} variant="swatch" />
        <CustomizationButton option={roofRack} />
      </>,
    );

    const paintButton = screen.getByRole("button", { name: "Blueprint" });
    const rackButton = screen.getByRole("button", { name: /overland roof rack/i });

    fireEvent.click(rackButton);
    expect(rackButton).toBeDisabled();
    expect(paintButton).not.toBeDisabled();

    await waitFor(() => expect(rackButton).not.toBeDisabled());
  });
});
