import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api/errors";
import { validateCreateLead } from "../lib/validation/lead";

function expectApiError(fn: () => unknown, status = 422, match?: RegExp): ApiError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(status);
    if (match) expect(apiError.message).toMatch(match);
    return apiError;
  }
  throw new Error("Expected the call to throw an ApiError.");
}

const validContact = {
  kind: "contact",
  name: "  Jamie Customer  ",
  email: "  JAMIE@Example.COM ",
  message: "  Please contact me about a Toyota.  ",
  idempotencyKey: "lead-submit-1",
};

describe("validateCreateLead", () => {
  it("accepts and normalizes a contact lead", () => {
    expect(validateCreateLead(validContact)).toEqual({
      kind: "contact",
      name: "Jamie Customer",
      email: "jamie@example.com",
      message: "Please contact me about a Toyota.",
      idempotencyKey: "lead-submit-1",
    });
  });

  it("accepts a model lead only when the vehicle id exists in the verified catalog", () => {
    expect(
      validateCreateLead({
        ...validContact,
        kind: "model",
        vehicleId: "rav4",
      }),
    ).toMatchObject({ kind: "model", vehicleId: "rav4" });

    expectApiError(
      () => validateCreateLead({ ...validContact, kind: "model", vehicleId: "not-a-real-vehicle" }),
      422,
      /vehicleId/i,
    );
  });

  it("requires model inquiries to identify a vehicle", () => {
    expectApiError(() => validateCreateLead({ ...validContact, kind: "model" }), 422, /vehicleId/i);
  });

  it("rejects unknown fields instead of silently accepting client-controlled data", () => {
    expectApiError(() => validateCreateLead({ ...validContact, price: 1, employee: "invented" }), 422, /unknown/i);
  });

  it("rejects invalid lead kinds", () => {
    expectApiError(() => validateCreateLead({ ...validContact, kind: "service" }), 422, /kind/i);
  });

  it("rejects blank, malformed, or oversized customer fields", () => {
    expectApiError(() => validateCreateLead({ ...validContact, name: "   " }), 422, /name/i);
    expectApiError(() => validateCreateLead({ ...validContact, email: "not-an-email" }), 422, /email/i);
    expectApiError(() => validateCreateLead({ ...validContact, email: `${"a".repeat(245)}@example.com` }), 422, /email/i);
    expectApiError(() => validateCreateLead({ ...validContact, message: "x".repeat(4001) }), 422, /message/i);
    expectApiError(() => validateCreateLead({ ...validContact, name: "x".repeat(121) }), 422, /name/i);
  });

  it("rejects oversized or malformed idempotency keys", () => {
    expectApiError(() => validateCreateLead({ ...validContact, idempotencyKey: "x".repeat(129) }), 422, /idempotency/i);
    expectApiError(() => validateCreateLead({ ...validContact, idempotencyKey: "contains spaces" }), 422, /idempotency/i);
  });

  it("rejects non-object bodies", () => {
    expectApiError(() => validateCreateLead(null));
    expectApiError(() => validateCreateLead("not an object"));
  });
});
