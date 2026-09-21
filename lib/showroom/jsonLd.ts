import { absoluteAssetUrl, absolutePageUrl } from "../site";
import { toVehicleQueryFacts, type Vehicle } from "../types/vehicle";

export interface VehicleJsonLd {
  "@context": "https://schema.org";
  "@type": "Product";
  name: string;
  brand: {
    "@type": "Brand";
    name: "Toyota";
  };
  image: string;
  url: string;
  offers: {
    "@type": "Offer";
    priceCurrency: "USD";
    price: number;
  };
}

/** Builds the catalog-backed structured data emitted on each static vehicle route. */
export function buildVehicleJsonLd(vehicle: Vehicle): VehicleJsonLd {
  const { startingMsrp } = toVehicleQueryFacts(vehicle);

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${vehicle.year} ${vehicle.model}`,
    brand: {
      "@type": "Brand",
      name: "Toyota",
    },
    image: absoluteAssetUrl(vehicle.media.hero.url),
    url: absolutePageUrl(vehicle.slug),
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price: startingMsrp,
    },
  };
}
