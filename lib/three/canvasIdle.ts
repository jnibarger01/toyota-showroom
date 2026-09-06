/**
 * Canvas idle suspension: stop the rAF render loop when the tab is hidden or the canvas host is
 * off-screen. Resume cleanly when either returns. Pure `computeSuspended` is unit-tested; the
 * observer wiring lives in `createCanvasIdleGate` for VehicleCanvas.
 */

export function computeSuspended(documentVisible: boolean, canvasIntersecting: boolean): boolean {
  return !documentVisible || !canvasIntersecting;
}

export type CanvasIdleGate = {
  /** True when rendering should be paused. */
  readonly suspended: boolean;
  dispose(): void;
};

export type CanvasIdleGateOptions = {
  /** IntersectionObserver rootMargin (default "0px"). */
  rootMargin?: string;
  /** IntersectionObserver threshold (default 0). */
  threshold?: number;
  /**
   * Initial canvas intersection assumption before the first observer callback.
   * Default true so the first frames still render until we know otherwise.
   */
  initiallyIntersecting?: boolean;
};

/**
 * Combines Page Visibility and IntersectionObserver into a single suspended flag.
 * `onChange` fires only when the boolean flips.
 */
export function createCanvasIdleGate(
  element: Element,
  onChange: (suspended: boolean) => void,
  options: CanvasIdleGateOptions = {},
): CanvasIdleGate {
  let documentVisible = typeof document === "undefined" ? true : document.visibilityState !== "hidden";
  let canvasIntersecting = options.initiallyIntersecting ?? true;
  let suspended = computeSuspended(documentVisible, canvasIntersecting);

  const emit = () => {
    const next = computeSuspended(documentVisible, canvasIntersecting);
    if (next === suspended) return;
    suspended = next;
    onChange(suspended);
  };

  const onVisibility = () => {
    documentVisible = document.visibilityState !== "hidden";
    emit();
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }

  let observer: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        canvasIntersecting = entry.isIntersecting && entry.intersectionRatio > 0;
        emit();
      },
      {
        root: null,
        rootMargin: options.rootMargin ?? "0px",
        threshold: options.threshold ?? 0,
      },
    );
    observer.observe(element);
  }

  return {
    get suspended() {
      return suspended;
    },
    dispose() {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      observer?.disconnect();
      observer = null;
    },
  };
}
