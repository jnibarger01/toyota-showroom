import type { DealerInventoryAvailability, DealerInventoryFeedAdapter, DealerInventoryUnit } from "../types";

const REQUIRED_COLUMNS = [
  "unit_id",
  "vehicle_id",
  "option_ids",
  "dealer_id",
  "availability",
] as const;

/**
 * Minimal RFC-4180-ish CSV split that handles quoted fields (commas inside quotes) without a
 * dependency. Dealer feeds are small fixture/API payloads — not multi-megabyte analytics dumps.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    // Skip blank trailing lines.
    if (row.length === 1 && row[0] === "" && field === "") {
      row = [];
      return;
    }
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      pushField();
      continue;
    }
    if (ch === "\n") {
      pushRow();
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      pushRow();
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}

function parseAvailability(raw: string): DealerInventoryAvailability {
  if (raw === "in_stock" || raw === "buildable") return raw;
  throw new Error(`Unknown availability "${raw}" (expected in_stock|buildable).`);
}

/**
 * Parse dealer inventory CSV text into units. Header must include the required columns; optional
 * columns are `dealer_name` and `distance_miles`. `option_ids` is a semicolon-separated list of
 * stable option ids (labels are never accepted).
 */
export function parseDealerInventoryCsv(text: string): DealerInventoryUnit[] {
  const rows = parseCsvRows(text.trim());
  if (rows.length === 0) return [];

  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  for (const required of REQUIRED_COLUMNS) {
    if (!header.includes(required)) {
      throw new Error(`Dealer inventory CSV missing required column "${required}".`);
    }
  }

  const idx = (name: string) => header.indexOf(name);
  const unitIdIdx = idx("unit_id");
  const vehicleIdIdx = idx("vehicle_id");
  const optionIdsIdx = idx("option_ids");
  const dealerIdIdx = idx("dealer_id");
  const availabilityIdx = idx("availability");
  const dealerNameIdx = idx("dealer_name");
  const distanceIdx = idx("distance_miles");

  const units: DealerInventoryUnit[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]!;
    if (cells.every((c) => c.trim() === "")) continue;

    const optionIds = cells[optionIdsIdx]!
      .split(";")
      .map((id) => id.trim())
      .filter(Boolean);

    if (optionIds.length === 0) {
      throw new Error(`Dealer inventory row ${r + 1} has no option_ids (stable ids are required).`);
    }

    const distanceRaw = distanceIdx >= 0 ? cells[distanceIdx]?.trim() : "";
    const distanceMiles =
      distanceRaw && distanceRaw.length > 0 ? Number(distanceRaw) : undefined;
    if (distanceMiles !== undefined && !Number.isFinite(distanceMiles)) {
      throw new Error(`Dealer inventory row ${r + 1} has invalid distance_miles "${distanceRaw}".`);
    }

    const dealerName = dealerNameIdx >= 0 ? cells[dealerNameIdx]?.trim() : undefined;

    units.push({
      id: cells[unitIdIdx]!.trim(),
      vehicleId: cells[vehicleIdIdx]!.trim(),
      optionIds,
      dealerId: cells[dealerIdIdx]!.trim(),
      ...(dealerName ? { dealerName } : {}),
      ...(distanceMiles !== undefined ? { distanceMiles } : {}),
      availability: parseAvailability(cells[availabilityIdx]!.trim()),
    });
  }

  return units;
}

/** CSV feed adapter — loads from an in-memory string or an async text provider. */
export class CsvDealerInventoryAdapter implements DealerInventoryFeedAdapter {
  readonly id: string;
  private readonly loadText: () => Promise<string>;

  constructor(options: { id?: string; csvText: string } | { id?: string; loadText: () => Promise<string> }) {
    this.id = options.id ?? "csv";
    this.loadText =
      "csvText" in options ? async () => options.csvText : options.loadText;
  }

  async load(): Promise<readonly DealerInventoryUnit[]> {
    const text = await this.loadText();
    return parseDealerInventoryCsv(text);
  }
}
