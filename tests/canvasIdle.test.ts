import { describe, expect, it, vi } from "vitest";
import { computeSuspended, createCanvasIdleGate } from "../lib/three/canvasIdle";

describe("computeSuspended", () => {
  it("suspends when the document is hidden", () => {
    expect(computeSuspended(false, true)).toBe(true);
  });

  it("suspends when the canvas is off-screen", () => {
    expect(computeSuspended(true, false)).toBe(true);
  });

  it("runs only when both document and canvas are visible", () => {
    expect(computeSuspended(true, true)).toBe(false);
  });
});

describe("createCanvasIdleGate", () => {
  it("emits when intersection flips off-screen", () => {
    const callbacks: IntersectionObserverCallback[] = [];
    class FakeObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0];
      constructor(cb: IntersectionObserverCallback) {
        callbacks.push(cb);
      }
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    const previous = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;

    try {
      const host = { nodeType: 1 } as unknown as Element;
      const onChange = vi.fn();
      const gate = createCanvasIdleGate(host, onChange, { initiallyIntersecting: true });
      expect(gate.suspended).toBe(false);

      callbacks[0]!(
        [
          {
            isIntersecting: false,
            intersectionRatio: 0,
            target: host,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );

      expect(onChange).toHaveBeenCalledWith(true);
      expect(gate.suspended).toBe(true);
      gate.dispose();
    } finally {
      globalThis.IntersectionObserver = previous;
    }
  });
});
