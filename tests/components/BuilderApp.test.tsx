import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { fourRunner } from "../../lib/data/vehicles/4runner";
import { fourRunnerOptions } from "../../lib/data/options/4runner";
import type { CreateConfigurationInput, UpdateConfigurationInput } from "../../lib/api/configurations";
import type { VehicleConfiguration } from "../../lib/types/customization";
import { encodeBuildDeepLink } from "../../lib/showroom/deepLink";
import { estimateBuildTotal, estimateMonthlyPayment, resolveGradeMsrp } from "../../lib/showroom/buildTools";

/**
 * `VehicleCanvas` renders a real WebGPU/WebGL scene, which jsdom cannot run. It is replaced with a
 * stub that immediately reports readiness with the *full* catalog treated as fully satisfied — the
 * real node-resolution behaviour is `tests/sceneController.test.ts` and `tests/glbContract.test.ts`'s
 * concern, not this file's. `fakeController` never fails an apply/remove, so this file can focus on
 * what BuilderApp itself is responsible for: bootstrapping, the grade selector (Task 6), and wiring
 * the catalog to CustomizationButton.
 */
const { fakeController } = vi.hoisted(() => ({
  fakeController: {
    applyOption: async () => true,
    removeOption: async () => true,
    // Mirrors the real VehicleSceneController.applyConfiguration's own documented behaviour:
    // clearing selection is not incidental, it's the point (a stale highlight must not survive a
    // full reapply) — see tests below for the BuilderApp-side half of that contract.
    applyConfiguration: async () => {
      fakeController.selectedPartId = undefined;
      return { applied: [], failed: [] };
    },
    selectedPartId: undefined as string | undefined,
    getPart: (id: string) => ({ id, type: "wheel", label: "Front-left wheel", capabilities: ["selectable"] }),
  },
}));

vi.mock("../../app/components/VehicleCanvas", () => ({
  VehicleCanvas: (props: {
    catalog: unknown[];
    onReady: (controller: unknown, applicable: unknown[]) => void;
    tourAction?: { seq: number; type: "play" | "pause" | "cancel" } | null;
    onTourStatusChange?: (status: "idle" | "playing" | "paused") => void;
    onTourStep?: (preset: { id: string; label: string; position: [number, number, number]; target: [number, number, number] }) => void;
    onPartSelect?: (part: { id: string; type: string; label: string; capabilities: string[] } | undefined) => void;
  }) => {
    useEffect(() => {
      props.onReady(fakeController, props.catalog);
      // Deliberately once: BuilderApp's own contract is that the base model is not reloaded for
      // option/lift/camera changes (see docs/INTEGRATION_GUIDE.md's acceptance criteria table,
      // #9) — re-firing onReady on every prop change would silently mask a regression there.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Mirror the real canvas tour command surface so chrome play/pause tests do not need WebGPU.
    useEffect(() => {
      if (!props.tourAction) return;
      if (props.tourAction.type === "play") {
        props.onTourStatusChange?.("playing");
        props.onTourStep?.({
          id: "wheels",
          label: "Wheels",
          position: [4.5, 1.05, 4.8],
          target: [-0.9, 0.55, 1.3],
        });
      } else if (props.tourAction.type === "pause") {
        props.onTourStatusChange?.("paused");
      } else {
        props.onTourStatusChange?.("idle");
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- stub mirrors tourAction only
    }, [props.tourAction]);
    return (
      <div data-testid="vehicle-canvas">
        {/* Stands in for a real pointer/keyboard click in VehicleCanvas: sets both halves a real
         * selection changes together (controller state + the onPartSelect callback), the same
         * pairing `VehicleCanvas.tsx`'s `handlePointerUp` performs. */}
        <button
          type="button"
          data-testid="simulate-3d-select"
          onClick={() => {
            fakeController.selectedPartId = "wheel.front-left";
            props.onPartSelect?.(fakeController.getPart("wheel.front-left"));
          }}
        >
          simulate 3D select
        </button>
      </div>
    );
  },
}));

vi.mock("../../lib/api/client", () => ({
  async getVehicle(slug: string) {
    if (slug !== "4runner") throw new Error(`unexpected slug ${slug}`);
    return fourRunner;
  },
  pageUrl(segment = "") {
    return `/${segment}${segment ? "/" : ""}`;
  },
}));

let revision = 1;

vi.mock("../../lib/api/configurations", () => ({
  async listVehicleOptions() {
    // Ungraded, matching the real signature since Task 6 — BuilderApp itself filters by grade.
    return fourRunnerOptions;
  },
  async createConfiguration(input: CreateConfigurationInput): Promise<VehicleConfiguration> {
    revision += 1;
    return {
      configurationId: `cfg-${revision}`,
      vehicleId: input.vehicleId,
      modelYear: input.modelYear,
      model: fourRunner.model,
      gradeId: input.gradeId,
      selections: input.selections ?? {},
      cameraState: input.cameraState,
      revision,
      schemaVersion: "1.0.0",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },
  async getConfiguration(): Promise<VehicleConfiguration> {
    throw new Error("no stored configuration in these tests");
  },
  async updateConfiguration(configurationId: string, input: UpdateConfigurationInput): Promise<VehicleConfiguration> {
    revision += 1;
    return {
      configurationId,
      vehicleId: fourRunner.slug,
      modelYear: fourRunner.year,
      model: fourRunner.model,
      gradeId: "trd-pro",
      selections: input.selections ?? {},
      cameraState: input.cameraState,
      revision,
      schemaVersion: "1.0.0",
      createdAt: "",
      updatedAt: new Date().toISOString(),
    };
  },
  getPersistenceMode() {
    return "local";
  },
  subscribePersistenceMode() {
    return () => {};
  },
  resetTransportDetection() {},
}));

const { BuilderApp } = await import("../../app/components/BuilderApp");
const { configurationStore } = await import("../../lib/state/configurationStore");

beforeEach(() => {
  revision = 1;
  window.localStorage.clear();
  configurationStore.reset();
  fakeController.selectedPartId = undefined; // fakeController is hoisted/shared across tests
});

afterEach(() => {
  configurationStore.reset();
  window.history.replaceState({}, "", "/");
});

/**
 * Renders and waits past both async gaps in bootstrap: the "4Runner" heading appears once
 * `vehicle`/`configuration` metadata loads (and `hydrate` publishes the grade-filtered catalog so
 * paint swatches are already present), but grade buttons stay `disabled` until `handleSceneReady`
 * attaches a scene controller — kicked off by the mocked VehicleCanvas's `onReady` effect. A bare
 * `findByRole("heading", ...)` races that second gap; CI caught this for real once (grade buttons
 * rendered `disabled=""` even though the heading itself was already on screen).
 */
async function renderBuilderReady(vehicleSlug = "4runner") {
  render(<BuilderApp vehicleSlug={vehicleSlug} />);
  await screen.findByRole("heading", { name: "4Runner" });
  await waitFor(() => expect(screen.getByRole("button", { name: /trd pro/i })).not.toBeDisabled());
}

describe("BuilderApp", () => {
  it("shows a loading state before the vehicle bootstraps", () => {
    render(<BuilderApp vehicleSlug="4runner" />);
    expect(screen.getByText(/loading 4runner/i)).toBeInTheDocument();
  });

  it("renders the vehicle, its default grade, and the option catalog once bootstrapped", async () => {
    await renderBuilderReady();
    expect(screen.getByTestId("vehicle-canvas")).toBeInTheDocument();

    // DEFAULT_GRADE in BuilderApp.tsx — the grade this configuration was created with.
    const trdPro = screen.getByRole("button", { name: /trd pro/i });
    expect(trdPro).toHaveClass("active");

    // "Paint" is the default activeCategory, so a real paint option renders without further
    // interaction, proving the store's post-verification catalog reached the right-panel's
    // CustomizationButton instances.
    expect(screen.getByRole("button", { name: /blueprint/i })).toBeInTheDocument();

    // The right panel only shows one category at a time (main's single-category redesign,
    // §12 in docs/INTEGRATION_GUIDE.md's known gaps notes the rail labels don't all match the
    // category they switch to — "Lighting" is the rail item that actually opens "accessory").
    fireEvent.click(screen.getByRole("button", { name: /lighting/i }));
    expect(screen.getByRole("button", { name: /overland roof rack/i })).toBeInTheDocument();
  });

  it("switching grades creates a new configuration and updates the active grade button", async () => {
    await renderBuilderReady();

    const sr5 = screen.getByRole("button", { name: /^sr5/i });
    fireEvent.click(sr5);

    await waitFor(() => expect(sr5).toHaveClass("active"));
    expect(screen.getByRole("button", { name: /trd pro/i })).not.toHaveClass("active");
    expect(configurationStore.getSnapshot().configuration?.gradeId).toBe("sr5");
  });

  it("clears a stale 3D-click selection badge once a configuration reapply (e.g. switching grades) resets the controller's own selection", async () => {
    await renderBuilderReady();

    // Simulate a 3D-viewport click selecting a part — the badge (app/components/BuilderApp.tsx's
    // .selected-part-badge) appears, backed by real React state (selectedPart), not a mock return.
    fireEvent.click(screen.getByTestId("simulate-3d-select"));
    await waitFor(() => expect(screen.getByText("Front-left wheel")).toBeInTheDocument());

    // Switching grades calls configurationStore.attachScene -> controller.applyConfiguration,
    // which clears the controller's own selection (fakeController mirrors that above). Nothing in
    // this flow calls onPartSelect directly — the fix under test is BuilderApp noticing the
    // controller's selection changed underneath it and reconciling on its own.
    const sr5 = screen.getByRole("button", { name: /^sr5/i });
    fireEvent.click(sr5);
    await waitFor(() => expect(sr5).toHaveClass("active"));

    expect(screen.queryByText("Front-left wheel")).not.toBeInTheDocument();
  });

  it("drops a grade-incompatible selection when switching to a grade that doesn't offer it", async () => {
    await renderBuilderReady();

    // Solar Octane is compatibleGradeIds: ["trd-pro"] only (lib/data/options/4runner.ts).
    const solarOctane = screen.getByRole("button", { name: /solar octane/i });
    fireEvent.click(solarOctane);
    await waitFor(() => expect(configurationStore.getSnapshot().configuration?.selections.paint).toEqual(["paint-0r2-solar-octane"]));

    const sr5 = screen.getByRole("button", { name: /^sr5/i });
    fireEvent.click(sr5);
    await waitFor(() => expect(configurationStore.getSnapshot().configuration?.gradeId).toBe("sr5"));

    expect(configurationStore.getSnapshot().configuration?.selections.paint ?? []).not.toContain("paint-0r2-solar-octane");
  });

  it("reset creates a fresh configuration with a new revision", async () => {
    await renderBuilderReady();

    const revisionRow = screen.getByText("Revision").closest("div")!;
    const before = revisionRow.querySelector("strong")?.textContent;

    fireEvent.click(screen.getByRole("button", { name: /reset/i }));

    await waitFor(() => {
      const after = revisionRow.querySelector("strong")?.textContent;
      expect(after).not.toBe(before);
    });
  });

  it("restores selections and camera from a ?c= deep link on bootstrap", async () => {
    const encoded = encodeBuildDeepLink({
      gradeId: "trd-pro",
      selections: { paint: ["paint-3u5-barcelona-red"] },
      cameraState: { presetId: "front", position: [0, 2.2, -10], target: [0, 1.0, 0] },
    });
    window.history.replaceState({}, "", `/4runner/?c=${encodeURIComponent(encoded)}`);

    await renderBuilderReady();

    await waitFor(() => {
      expect(configurationStore.getSnapshot().configuration?.selections.paint).toEqual([
        "paint-3u5-barcelona-red",
      ]);
    });
    expect(configurationStore.getSnapshot().configuration?.cameraState?.presetId).toBe("front");
    expect(screen.getByRole("button", { name: "Barcelona Red Metallic" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Front" })).toHaveClass("selected");
  });

  it("updates the running build total and financing payment when an option with priceDelta is selected", async () => {
    await renderBuilderReady();

    const base = resolveGradeMsrp(fourRunner, "trd-pro");
    expect(screen.getByTestId("estimated-total")).toHaveTextContent(`$${base.toLocaleString()}`);
    expect(screen.getByTestId("amount-financed")).toHaveTextContent(`$${base.toLocaleString()}`);

    fireEvent.click(screen.getByRole("button", { name: /solar octane/i }));
    await waitFor(() =>
      expect(configurationStore.getSnapshot().configuration?.selections.paint).toEqual(["paint-0r2-solar-octane"]),
    );

    const expectedTotal = base + 425;
    await waitFor(() => expect(screen.getByTestId("estimated-total")).toHaveTextContent(`$${expectedTotal.toLocaleString()}`));
    expect(screen.getByTestId("amount-financed")).toHaveTextContent(`$${expectedTotal.toLocaleString()}`);

    const expectedMonthly = estimateMonthlyPayment(expectedTotal, 6.9, 60).toLocaleString(undefined, {
      maximumFractionDigits: 0,
    });
    expect(screen.getByTestId("estimated-monthly-payment")).toHaveTextContent(`$${expectedMonthly}/mo`);
  });

  it("re-derives the same estimated total after restoring selections from a deep link", async () => {
    const encoded = encodeBuildDeepLink({
      gradeId: "trd-pro",
      selections: { paint: ["paint-0r2-solar-octane"], accessory: ["accessory-roof-rack"] },
    });
    window.history.replaceState({}, "", `/4runner/?c=${encodeURIComponent(encoded)}`);

    await renderBuilderReady();

    await waitFor(() => {
      expect(configurationStore.getSnapshot().configuration?.selections.paint).toEqual(["paint-0r2-solar-octane"]);
    });

    // Deep-link restore creates a config; catalog may still be grade-filtered in the store.
    fireEvent.click(screen.getByRole("button", { name: /lighting/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /overland roof rack/i })).toHaveAttribute("aria-pressed", "true"));

    const expected = estimateBuildTotal(
      resolveGradeMsrp(fourRunner, "trd-pro"),
      fourRunnerOptions,
      configurationStore.getSnapshot().configuration,
    );
    expect(expected).toBe(53_900 + 425 + 1_150);
    await waitFor(() => expect(screen.getByTestId("estimated-total")).toHaveTextContent(`$${expected.toLocaleString()}`));
    expect(screen.getByTestId("amount-financed")).toHaveTextContent(`$${expected.toLocaleString()}`);
  });

  it("plays and pauses the cinematic tour from builder chrome", async () => {
    await renderBuilderReady();

    const toggle = await screen.findByTestId("cinematic-tour-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveTextContent(/Tour/i);

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "true"));
    expect(toggle).toHaveTextContent(/Pause/i);
    expect(configurationStore.getSnapshot().configuration?.cameraState?.presetId).toBe("wheels");

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveTextContent(/Resume/i));
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("cancels a running cinematic tour when the view is recentred", async () => {
    await renderBuilderReady();

    const toggle = await screen.findByTestId("cinematic-tour-toggle");
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "true"));

    // The tour drives the camera from a GSAP timeline, so a recentre underneath it would be
    // overwritten on the tour's very next frame — the control has to stop the tour first.
    fireEvent.click(screen.getByTestId("recenter-view"));

    await waitFor(() => expect(toggle).toHaveTextContent(/Tour/i));
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("names the camera control Recenter so it cannot be confused with the build Reset", async () => {
    await renderBuilderReady();

    // Two controls both called "Reset" — one moving the camera, one discarding the configuration —
    // would be a genuine hazard, not just an ambiguous query.
    expect(screen.getByTestId("recenter-view")).toHaveAccessibleName(/recenter/i);
    expect(screen.getAllByRole("button", { name: /^reset$/i })).toHaveLength(1);
  });

  it("cancels the cinematic tour when a camera preset is chosen manually", async () => {
    await renderBuilderReady();

    const toggle = await screen.findByTestId("cinematic-tour-toggle");
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(screen.getByRole("button", { name: /^Hero$/i }));
    await waitFor(() => expect(toggle).toHaveTextContent(/Tour/i));
    expect(configurationStore.getSnapshot().configuration?.cameraState?.presetId).toBe("hero");
  });
});
