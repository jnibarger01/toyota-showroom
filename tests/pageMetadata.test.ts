import { describe, expect, it } from "vitest";
import garageLayout, { metadata as garageMetadata } from "../app/garage/layout";
import compareLayout, { metadata as compareMetadata } from "../app/compare/layout";
import { absolutePageUrl } from "../lib/site";

/**
 * Route metadata for the two shareable utility pages.
 *
 * `/garage` and `/compare` both produce shareable deep links, but neither had a route layout —
 * so both rendered with the root layout's generic "Toyota Showroom" title, root OG card, and no
 * canonical, even though `/explore` already had exactly this treatment. These tests pin the
 * metadata so the pages cannot silently regress to inheriting the root card.
 */
describe("utility-page route metadata", () => {
  it("garage declares its own title, OG card, and canonical", () => {
    expect(garageMetadata.title).toBe("Garage | Toyota Showroom");
    expect(garageMetadata.openGraph?.url).toBe(absolutePageUrl("garage"));
    expect(garageMetadata.openGraph?.title).toBe("Garage | Toyota Showroom");
    expect(garageMetadata.alternates?.canonical).toBe(absolutePageUrl("garage"));
  });

  it("compare declares its own title, OG card, and canonical", () => {
    expect(compareMetadata.title).toBe("Compare | Toyota Showroom");
    expect(compareMetadata.openGraph?.url).toBe(absolutePageUrl("compare"));
    expect(compareMetadata.openGraph?.title).toBe("Compare | Toyota Showroom");
    expect(compareMetadata.alternates?.canonical).toBe(absolutePageUrl("compare"));
  });

  it("layouts are pass-through wrappers like the explore layout", () => {
    expect(garageLayout({ children: "x" })).toBe("x");
    expect(compareLayout({ children: "x" })).toBe("x");
  });
});
