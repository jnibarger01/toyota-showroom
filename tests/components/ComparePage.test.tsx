import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { VehicleSummary } from "../../lib/types/vehicle";

/**
 * `ComparePage`'s catalog mode is reachable straight from a shareable `/compare?vehicles=…` link,
 * so that link is free text a visitor can edit, truncate, or keep after the catalog changed. These
 * tests pin the reconciliation the page does against the loaded catalog: an unknown slug must not
 * stay in the selection (it would consume a `MAX_COMPARE` slot the picker cannot show or uncheck),
 * must not be re-written into the "Update comparison" link, and must be reported rather than
 * silently ignored.
 *
 * The catalog is mocked at the `lib/api/client` seam — the same boundary the page itself uses — so
 * the assertions are about the controller's behavior, not about a stubbed helper.
 */
function summary(slug: string, model = slug): VehicleSummary {
  return {
    slug,
    year: 2024,
    model,
    updatedAt: "2026-01-01T00:00:00.000Z",
    bodyStyle: "suv",
    categories: [],
    availability: "in_production",
    drivetrains: ["awd"],
    powertrainTypes: ["gas"],
    maxSeating: 5,
    maxTowingLbs: 0,
    startingMsrp: 30_000,
    thumbnail: { url: `/images/${slug}.png`, alt: slug },
  };
}

const FIXTURE: VehicleSummary[] = [
  summary("rav4"),
  summary("gr-supra"),
  summary("camry"),
  summary("tacoma"),
  summary("highlander"),
];

vi.mock("../../lib/api/client", () => ({
  async listVehicles() {
    return { data: FIXTURE, page: 1, pageSize: FIXTURE.length, totalItems: FIXTURE.length, totalPages: 1 };
  },
  async compareVehicles() {
    return [];
  },
  async getVehicle() {
    throw new Error("not used in catalog mode");
  },
  pageUrl(segment = "") {
    return `/${segment}${segment ? "/" : ""}`;
  },
  MAX_COMPARE: 4,
  MIN_COMPARE: 2,
}));

vi.mock("../../lib/api/configurations", () => ({
  async getConfiguration() {
    throw new Error("not used in catalog mode");
  },
}));

const { default: ComparePage } = await import("../../app/compare/page");

/** Each test starts from the URL it wants to exercise; jsdom's base URL is `http://localhost/`. */
function open(url: string) {
  window.history.replaceState(null, "", url);
  return render(<ComparePage />);
}

beforeEach(() => {
  window.history.replaceState(null, "", "/compare");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ComparePage catalog deep link", () => {
  it("reports a vehicle the catalog doesn't have instead of ignoring it", async () => {
    open("/compare?vehicles=rav4,gr-supra,ghost-model");

    const notice = await screen.findByTestId("compare-unknown-vehicles");
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveTextContent("ghost-model");
    expect(notice).toHaveTextContent("left out");
  });

  it("keeps the 'Update comparison' link free of the unknown slug", async () => {
    open("/compare?vehicles=rav4,gr-supra,ghost-model");

    const link = await screen.findByRole("link", { name: /update comparison/i });
    expect(link).toHaveAttribute("href", "/compare/?vehicles=rav4,gr-supra");
  });

  it("does not let an unknown slug consume a MAX_COMPARE slot", async () => {
    // Four slugs, one of which the catalog doesn't know: three real vehicles are selected, so the
    // one remaining catalog vehicle must still be selectable. Before the reconciliation the ghost
    // counted, `picked.length` reached MAX_COMPARE (4) and every unchecked box was disabled with
    // no explanation on screen.
    open("/compare?vehicles=rav4,gr-supra,camry,ghost-model");

    const tacoma = await screen.findByRole("checkbox", { name: "2024 tacoma" });
    expect(screen.getByRole("checkbox", { name: "2024 rav4" })).toBeChecked();
    expect(tacoma).not.toBeChecked();
    expect(tacoma).not.toBeDisabled();
  });

  it("still caps the picker at MAX_COMPARE real vehicles", async () => {
    open("/compare?vehicles=rav4,gr-supra,camry,tacoma");

    // All four are real, so the cap is genuinely reached: the fifth catalog vehicle is disabled.
    const highlander = await screen.findByRole("checkbox", { name: "2024 highlander" });
    expect(screen.getByRole("checkbox", { name: "2024 tacoma" })).toBeChecked();
    expect(highlander).toBeDisabled();

    // Freeing a real slot frees the picker — the cap counts real vehicles, not link text.
    fireEvent.click(screen.getByRole("checkbox", { name: "2024 tacoma" }));
    expect(highlander).not.toBeDisabled();
    fireEvent.click(highlander);
    expect(highlander).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "2024 tacoma" })).toBeDisabled();
  });

  it("says nothing when every slug in the link is real", async () => {
    open("/compare?vehicles=rav4,gr-supra");

    await screen.findByRole("link", { name: /update comparison/i });
    expect(screen.queryByTestId("compare-unknown-vehicles")).not.toBeInTheDocument();
  });

  it("lets the visitor dismiss the notice", async () => {
    open("/compare?vehicles=rav4,ghost-model");

    const notice = await screen.findByTestId("compare-unknown-vehicles");
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(screen.queryByTestId("compare-unknown-vehicles")).not.toBeInTheDocument();
    expect(notice).not.toBeInTheDocument();
  });
});