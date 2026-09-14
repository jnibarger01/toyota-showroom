import {
  CsvDealerInventoryAdapter,
  exploreBadgesByVehicle,
  type DealerInventoryFeedAdapter,
  type DealerInventoryUnit,
  type InventoryBadge,
} from "../dealerInventory";

/**
 * Client helpers for Explore inventory badges (#20).
 *
 * Catalog load (`listVehicles`) and inventory load are independent: Explore must never wait on
 * this feed before rendering the lineup. Failures here are non-fatal — badges simply stay absent.
 */

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function inventoryCsvUrl(): string {
  return `${basePath}/catalog/v1/dealer-inventory.csv`;
}

let inventoryCache: Promise<readonly DealerInventoryUnit[]> | null = null;

/** Override point for tests; production uses the static CSV fixture under /catalog/v1/. */
export function createBrowserCsvAdapter(
  loadText: () => Promise<string> = async () => {
    const response = await fetch(inventoryCsvUrl());
    if (!response.ok) {
      throw new Error(`Failed to load dealer inventory feed (${response.status}).`);
    }
    return response.text();
  },
): DealerInventoryFeedAdapter {
  return new CsvDealerInventoryAdapter({ id: "csv-fixture", loadText });
}

/**
 * Load inventory units. An explicit `adapter` always bypasses the browser cache (tests / swaps);
 * the default path caches one promise so Explore remounts do not re-fetch the CSV.
 */
export async function loadDealerInventory(
  adapter?: DealerInventoryFeedAdapter,
): Promise<readonly DealerInventoryUnit[]> {
  if (adapter) return adapter.load();
  if (!inventoryCache) {
    inventoryCache = createBrowserCsvAdapter().load();
  }
  return inventoryCache;
}

/** Test-only: drop the in-memory inventory promise so the next load hits the adapter again. */
export function resetDealerInventoryCache(): void {
  inventoryCache = null;
}

/**
 * Resolve Explore badges for the given vehicle slugs. Safe to call in parallel with catalog
 * fetch — callers should treat rejection / empty maps as "no badges", never as a page error.
 */
export async function loadExploreInventoryBadges(
  vehicleIds: readonly string[],
  adapter?: DealerInventoryFeedAdapter,
): Promise<Map<string, InventoryBadge[]>> {
  const units = await loadDealerInventory(adapter);
  return exploreBadgesByVehicle(units, vehicleIds);
}
