import { CsvDealerInventoryAdapter } from "./adapters/csv";
import { DEALER_INVENTORY_CSV_FIXTURE } from "./csvFixture";
import type { DealerInventoryFeedAdapter } from "./types";

/** Default pluggable feed: in-repo CSV fixture (no network). */
export function createCsvFixtureAdapter(): DealerInventoryFeedAdapter {
  return new CsvDealerInventoryAdapter({
    id: "csv-fixture",
    csvText: DEALER_INVENTORY_CSV_FIXTURE,
  });
}
