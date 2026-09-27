import { describe, expect, it } from "vitest";
import { sequenceQaErrors } from "../scripts/spins/validate";

function constant(value: number): Uint8Array {
  return new Uint8Array(64 * 40).fill(value);
}

describe("spin image sequence QA", () => {
  it("accepts a smooth circular sequence", () => {
    const samples = Array.from({ length: 24 }, (_, frame) => {
      const theta = (frame / 24) * Math.PI * 2;
      return Uint8Array.from({ length: 64 * 40 }, (_, pixel) => {
        const phase = (pixel / (64 * 40)) * Math.PI * 2;
        return Math.round(128 + 50 * Math.sin(theta + phase));
      });
    });
    expect(sequenceQaErrors(samples)).toEqual([]);
  });

  it("detects an immediate direction reversal", () => {
    const samples = Array.from({ length: 24 }, () => constant(100));
    samples[10] = constant(120);
    expect(sequenceQaErrors(samples).some((message) => message.includes("direction reversal"))).toBe(true);
  });

  it("rejects incomplete sequences", () => {
    expect(sequenceQaErrors(Array.from({ length: 23 }, () => constant(100)))).toEqual([
      "expected 24 frame samples, got 23",
    ]);
  });
});