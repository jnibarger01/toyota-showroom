import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { VehicleSummary } from "../../lib/types/vehicle";
import { DEFAULT_PAGE_SIZE } from "../../lib/api/query";

/**
 * `ExplorePage` fetches its full catalog through `listVehicles` once (needed so the body-style
 * filter chips stay populated with every style, not just whatever the current page happens to
 * show — see the component's own comment) and paginates client-side over the result. With the
 * real production catalog (3 vehicles, well under `DEFAULT_PAGE_SIZE`) that pagination pass is
 * invisible — this fixture ships more than a page's worth specifically to exercise it, which the
 * real catalog can't today (docs/INTEGRATION_GUIDE.md's "Known gaps" note on this same page,
 * §11, before this task wired the controls in at all).
 */
function summary(overrides: Partial<VehicleSummary> & { slug: string }): VehicleSummary {
  return {
    year: 2024,
    model: overrides.slug,
    updatedAt: "2026-01-01T00:00:00.000Z",
    bodyStyle: "suv",
    categories: [],
    availability: "in_production",
    drivetrains: ["awd"],
    powertrainTypes: ["gas"],
    maxSeating: 5,
    maxTowingLbs: 0,
    startingMsrp: 30000,
    thumbnail: { url: `/images/${overrides.slug}.png`, alt: overrides.slug },
    ...overrides,
  };
}

const SUV_COUNT = DEFAULT_PAGE_SIZE - 2; // 10 when DEFAULT_PAGE_SIZE is 12
const TRUCK_COUNT = 4;
const FIXTURE: VehicleSummary[] = [
  ...Array.from({ length: SUV_COUNT }, (_, i) => summary({ slug: `suv-${i}`, bodyStyle: "suv" })),
  ...Array.from({ length: TRUCK_COUNT }, (_, i) => summary({ slug: `truck-${i}`, bodyStyle: "truck" })),
];
const TOTAL = FIXTURE.length; // 14 when DEFAULT_PAGE_SIZE is 12 — spans exactly two pages

vi.mock("../../lib/api/client", () => ({
  async listVehicles() {
    return { data: FIXTURE, page: 1, pageSize: FIXTURE.length, totalItems: FIXTURE.length, totalPages: 1 };
  },
  pageUrl(segment = "") {
    return `/${segment}${segment ? "/" : ""}`;
  },
  MAX_COMPARE: 4,
}));

const { default: ExplorePage } = await import("../../app/explore/page");

describe("ExplorePage pagination", () => {
  it("shows one page's worth of cards, with a disabled Previous and an enabled Next", async () => {
    render(<ExplorePage />);
    await waitFor(() => expect(screen.getAllByRole("link", { name: /suv-0|truck-0/i }).length).toBeGreaterThan(0));

    expect(screen.getAllByText(/^suv-|^truck-/, { selector: "h2" })).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(screen.getByText(`Page 1 of ${Math.ceil(TOTAL / DEFAULT_PAGE_SIZE)}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^next/i })).not.toBeDisabled();
  });

  it("advances to the next page and shows the remainder", async () => {
    render(<ExplorePage />);
    await screen.findByText(`Page 1 of ${Math.ceil(TOTAL / DEFAULT_PAGE_SIZE)}`);

    fireEvent.click(screen.getByRole("button", { name: /^next/i }));

    await waitFor(() => expect(screen.getByText(`Page 2 of ${Math.ceil(TOTAL / DEFAULT_PAGE_SIZE)}`)).toBeInTheDocument());
    expect(screen.getAllByText(/^suv-|^truck-/, { selector: "h2" })).toHaveLength(TOTAL - DEFAULT_PAGE_SIZE);
    expect(screen.getByRole("button", { name: /^next/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /previous/i })).not.toBeDisabled();
  });

  it("resets to page 1 and hides pagination when a filter narrows the result to one page", async () => {
    render(<ExplorePage />);
    await screen.findByText(`Page 1 of ${Math.ceil(TOTAL / DEFAULT_PAGE_SIZE)}`);

    fireEvent.click(screen.getByRole("button", { name: /^next/i }));
    await screen.findByText(`Page 2 of ${Math.ceil(TOTAL / DEFAULT_PAGE_SIZE)}`);

    fireEvent.click(screen.getByRole("button", { name: /^truck$/i }));

    await waitFor(() => expect(screen.getAllByText(/^truck-/, { selector: "h2" })).toHaveLength(TRUCK_COUNT));
    expect(screen.queryByText(/^suv-/)).not.toBeInTheDocument();
    // Only one page's worth of trucks (4, well under DEFAULT_PAGE_SIZE) — no page-2 control to
    // show, matching the pre-existing "nothing to page to" behaviour this task's own docs note.
    expect(screen.queryByRole("navigation", { name: /lineup pages/i })).not.toBeInTheDocument();
  });
});
