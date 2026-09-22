import { describe, expect, it } from "vitest";
import { getVehicleBySlug } from "../lib/data/vehicles";
import { buildVehicleJsonLd } from "../lib/showroom/jsonLd";
import { SITE_URL } from "../lib/site";
import { toVehicleQueryFacts } from "../lib/types/vehicle";

describe("vehicle JSON-LD (#122)", () => {
  it.each(["4runner", "camry"])("maps the \"%s\" catalog entry to structured data", (slug) => {
    const vehicle = getVehicleBySlug(slug);
    expect(vehicle).toBeDefined();

    const jsonLd = buildVehicleJsonLd(vehicle!);
    const facts = toVehicleQueryFacts(vehicle!);

    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["@type"]).toBe("Product");
    expect(jsonLd.name).toBe(`${vehicle!.year} ${vehicle!.model}`);
    expect(jsonLd.brand).toEqual({ "@type": "Brand", name: "Toyota" });
    expect(jsonLd.image.startsWith(`${SITE_URL}/`)).toBe(true);
    expect(jsonLd.image.startsWith("https://")).toBe(true);
    expect(jsonLd.url).toBe(`${SITE_URL}/${slug}/`);
    expect(jsonLd.url.startsWith("https://")).toBe(true);
    expect(jsonLd.offers.price).toBe(facts.startingMsrp);
    expect(jsonLd.offers.priceCurrency).toBe("USD");
    expect(jsonLd.offers).not.toHaveProperty("availability");
  });
});
