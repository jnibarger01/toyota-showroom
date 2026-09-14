import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  GARAGE_PERSISTENCE_NOTE_COPY,
  PERSISTENCE_MODE_BANNER_COPY,
  PersistenceModeBanner,
} from "../../app/components/PersistenceModeBanner";

/**
 * Targeted copy coverage for #77 — demo/offline banner strings are product-critical and have
 * drifted in full-chrome snapshots. Assert the constants and the thin presentational component
 * for worker vs local; do not mount BuilderApp.
 */

describe("PERSISTENCE_MODE_BANNER_COPY", () => {
  it("pins the local demo/offline banner title and body", () => {
    expect(PERSISTENCE_MODE_BANNER_COPY.local.title).toBe("Demo / offline saves");
    expect(PERSISTENCE_MODE_BANNER_COPY.local.body).toBe(
      "builds stay in this browser. Share uses a deep link so others can open your build without Worker/D1. Production persistence is Cloudflare Worker + D1; see the deployment runbook to promote.",
    );
  });

  it("keeps garage local note distinct and pinned", () => {
    expect(GARAGE_PERSISTENCE_NOTE_COPY).toBe(
      "Demo / offline mode — builds stay in this browser (localStorage), not Worker/D1.",
    );
    expect(GARAGE_PERSISTENCE_NOTE_COPY).toMatch(/localStorage/i);
    expect(GARAGE_PERSISTENCE_NOTE_COPY).not.toEqual(PERSISTENCE_MODE_BANNER_COPY.local.title);
  });
});

describe("PersistenceModeBanner", () => {
  it("renders local-mode banner with the pinned copy", () => {
    render(<PersistenceModeBanner mode="local" />);

    const banner = screen.getByTestId("persistence-mode-banner");
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveTextContent(PERSISTENCE_MODE_BANNER_COPY.local.title);
    expect(banner).toHaveTextContent(PERSISTENCE_MODE_BANNER_COPY.local.body);
    expect(banner).toHaveTextContent(/Demo \/ offline saves/);
    expect(banner).toHaveTextContent(/Worker\/D1/);
  });

  it("renders nothing in worker mode (production persistence needs no disclaimer)", () => {
    const { container } = render(<PersistenceModeBanner mode="worker" />);
    expect(screen.queryByTestId("persistence-mode-banner")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while persistence mode is still unknown", () => {
    const { container } = render(<PersistenceModeBanner mode="unknown" />);
    expect(screen.queryByTestId("persistence-mode-banner")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
