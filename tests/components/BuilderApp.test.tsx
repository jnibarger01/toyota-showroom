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
    applyConfiguration: async () => ({ applied: [], failed: [] }),
  },
}));

vi.mock("../../app/components/VehicleCanvas", () => ({
  VehicleCanvas: (props: { catalog: unknown[]; onReady: (controller: unknown, applicable: unknown[]) => void }) => {
    useEffect(() => {
      props.onReady(fakeController, props.catalog);
      // Deliberately once: BuilderApp's own contract is that the base model is not reloaded for
      // option/lift/camera changes (see docs/INTEGRATION_GUIDE.md's acceptance criteria table,
      // #9) — re-firing onReady on every prop change would silently mask a regression there.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="vehicle-canvas" />;
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
});
