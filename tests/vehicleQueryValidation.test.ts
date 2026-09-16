import { describe, expect, it } from "vitest";
import { encodeVehicleCursor } from "../lib/api/query";
import { parseVehicleQuery } from "../lib/validation/vehicle-query";

describe("vehicle query contract", () => {
  it("decodes a supported opaque cursor", () => {
    const parsed = parseVehicleQuery(
      new URLSearchParams({ cursor: encodeVehicleCursor(24), pageSize: "12" }),
    );
    expect(parsed.pagination).toEqual({
      page: 1,
      pageSize: 12,
      cursorOffset: 24,
    });
  });

  it("fails closed on malformed cursors", () => {
    expect(() =>
      parseVehicleQuery(new URLSearchParams({ cursor: "24" })),
    ).toThrowError(/malformed or unsupported/);
  });

  it("rejects ambiguous page and cursor requests", () => {
    expect(() =>
      parseVehicleQuery(
        new URLSearchParams({ page: "2", cursor: encodeVehicleCursor(12) }),
      ),
    ).toThrowError(/mutually exclusive/);
  });

  it("rejects unknown query parameters instead of silently ignoring typos", () => {
    expect(() =>
      parseVehicleQuery(new URLSearchParams({ pageSze: "50" })),
    ).toThrowError(/Unknown query parameter/);
  });
});
