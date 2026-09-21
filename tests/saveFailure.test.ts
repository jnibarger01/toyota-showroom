import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api/errors";
import {
  SAVE_FAILURE_COPY,
  isRevisionConflict,
  messageForSaveFailure,
  saveFailureReason,
} from "../lib/api/saveFailure";

describe("saveFailure copy (#52)", () => {
  it("keeps stale-revision, network, and validation copy distinct", () => {
    const messages = [
      SAVE_FAILURE_COPY.conflict,
      SAVE_FAILURE_COPY.network,
      SAVE_FAILURE_COPY.validation,
      SAVE_FAILURE_COPY.unknown,
    ];
    expect(new Set(messages).size).toBe(messages.length);
    expect(SAVE_FAILURE_COPY.conflict).toMatch(/stale revision/i);
    expect(SAVE_FAILURE_COPY.network).toMatch(/cloud save service|connection/i);
    expect(SAVE_FAILURE_COPY.validation).toMatch(/not valid/i);
  });

  it("classifies ApiError codes the same way as funnel telemetry", () => {
    expect(saveFailureReason(new ApiError(409, "revision_conflict", "stale"))).toBe("conflict");
    expect(saveFailureReason(new ApiError(0, "network_error", "down"))).toBe("network");
    expect(saveFailureReason(new ApiError(422, "invalid_body", "bad option"))).toBe("validation");
    expect(saveFailureReason(new Error("boom"))).toBe("unknown");
  });

  it("maps each reason to its dedicated user-facing message", () => {
    expect(messageForSaveFailure(new ApiError(409, "revision_conflict", "raw"))).toBe(
      SAVE_FAILURE_COPY.conflict,
    );
    expect(messageForSaveFailure(new ApiError(0, "network_error", "raw"))).toBe(SAVE_FAILURE_COPY.network);
    expect(messageForSaveFailure(new ApiError(422, "invalid_body", "raw"))).toBe(
      SAVE_FAILURE_COPY.validation,
    );
  });

  it("detects revision conflicts for Worker recovery gating", () => {
    expect(isRevisionConflict(new ApiError(409, "revision_conflict", "stale"))).toBe(true);
    expect(isRevisionConflict(new ApiError(0, "network_error", "down"))).toBe(false);
  });
});
