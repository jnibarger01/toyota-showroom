"use client";

import { Component, Fragment, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import type { MediaAsset } from "../../lib/types/vehicle";

/**
 * Keeps a failed 3D stage from taking the whole page with it.
 *
 * `VehicleCanvas` already handles the failures it can see coming — a GLB that will not fetch or
 * decode falls back to a procedural vehicle inside its own try/catch (and surfaces
 * `CanvasModelStatus` for the asset path). What it cannot handle is anything that throws during
 * *render*, because at that point React unmounts the tree and, with no boundary above it, that
 * means the entire route. The realistic causes are not exotic:
 *
 *   - **Chunk load failure.** `VehicleCanvas` is `lazy()`-imported, and a deploy that replaces
 *     hashed assets while someone has the page open makes their next chunk fetch 404. Very common,
 *     and entirely invisible in testing.
 *   - **No GPU adapter / WebGL context loss.** `createRenderer` requests WebGPU and falls back to
 *     WebGL2, but a machine or hardened browser profile with neither — or a GPU reset that surfaces
 *     as a throw — leaves nothing to fall back to.
 *   - **Asset decode that escapes the try/catch** (e.g. a synchronous GLB/Draco blow-up during a
 *     render path rather than the awaited load).
 *   - **A genuine bug** in scene setup, which should cost the viewport and not the configurator.
 *
 * Before this, any of those produced a white screen: no vehicle, no price, no option list, no way
 * to recover short of a reload the user has no reason to believe would help.
 *
 * The fallback is the vehicle's own hero render, which is already in the media manifest and
 * already being downloaded for the rest of the page. That matters — a static image of the actual
 * configured vehicle keeps the page *useful* (the whole panel of controls, pricing, and the lead
 * form still works) rather than merely non-broken.
 *
 * Copy distinguishes GPU/context loss from asset failure when the thrown error's message or name
 * makes that callably clear (#58). Ambiguous failures keep the generic wording so we never blame
 * the wrong layer.
 *
 * A class component because React has no hook equivalent: `componentDidCatch` and
 * `getDerivedStateFromError` are the only error-boundary API.
 */

export type CanvasErrorKind = "gpu" | "asset" | "generic";

export const CANVAS_ERROR_BOUNDARY_COPY = {
  gpu: {
    title: "Graphics view interrupted",
    body:
      "The GPU or WebGL context was lost or is unavailable. Try again — every configuration option below still works.",
  },
  asset: {
    title: "3D model could not be shown",
    body:
      "The vehicle file failed to decode or load into the viewer. Try again — every configuration option below still works.",
  },
  generic: {
    title: "Interactive view unavailable",
    body: "Showing a static image instead. Every configuration option below still works.",
  },
} as const;

/**
 * Fixed-cardinality classifier for fallback copy.
 *
 * Order matters: GPU/context patterns are checked before asset patterns so a message like
 * "WebGL failed to decode texture" still reads as a graphics failure (the actionable recovery is
 * the same Retry remount either way; the copy is what changes).
 *
 * Deliberately message/name based — render throws do not carry a structured code the way API
 * errors do, and inventing one at the throw site would require every Three.js / lazy-import path
 * to cooperate. Matching on the wording those libraries already emit is enough for the cases
 * acceptance asks us to distinguish.
 */
export function classifyCanvasError(error: unknown): CanvasErrorKind {
  const text = canvasErrorText(error);
  if (!text) return "generic";

  if (
    /webgl|webgpu|\bgpu\b|context\s*lost|contextlost|lose_context|no (?:gpu )?adapter|adapter (?:is )?unavailable|graphics (?:context|device)/i.test(
      text,
    )
  ) {
    return "gpu";
  }

  if (
    /\bglb\b|\bgltf\b|draco|decode|model (?:file |could not |failed)|failed to load (?:the )?(?:model|asset|mesh)|asset (?:load|decode)|invalid\s+(?:gltf|glb)/i.test(
      text,
    )
  ) {
    return "asset";
  }

  return "generic";
}

function canvasErrorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name} ${error.message}`.trim();
  }
  if (typeof error === "string") return error;
  return "";
}

interface Props {
  children: ReactNode;
  /** The vehicle's hero render, shown in place of the live scene. */
  fallbackImage?: MediaAsset;
  /** Notifies the host so it can surface the failure in its own error channel. */
  onError?: (error: Error) => void;
}

interface State {
  error: Error | null;
  /**
   * Bumped on retry to re-key the subtree.
   *
   * Without a changing key React reuses the existing (failed) element identity and the remount is
   * not guaranteed to re-run the lazy import — the retry button would appear to do nothing, which
   * is worse than not offering one.
   */
  attempt: number;
}

export class CanvasErrorBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    // Logged before notifying: `onError` is host code that could itself throw, and the diagnostic
    // is the more important of the two.
    console.error("[canvas] 3D stage failed to render.", error, info.componentStack);
    this.props.onError?.(error);
  }

  private retry = (): void => {
    this.setState((state) => ({ error: null, attempt: state.attempt + 1 }));
  };

  render(): ReactNode {
    const { error, attempt } = this.state;
    const { children, fallbackImage } = this.props;

    if (!error) {
      // A keyed Fragment rather than a keyed wrapper element: the remount semantics are identical,
      // and this introduces no DOM node into the stage's absolutely-positioned layout.
      return <Fragment key={attempt}>{children}</Fragment>;
    }

    const kind = classifyCanvasError(error);
    const copy = CANVAS_ERROR_BOUNDARY_COPY[kind];

    return (
      <div
        className="vehicle-canvas canvas-fallback"
        role="alert"
        data-testid="canvas-error-fallback"
        data-error-kind={kind}
      >
        {fallbackImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- static export; no image optimizer.
          <img className="canvas-fallback-image" src={fallbackImage.url} alt={fallbackImage.alt} />
        ) : null}
        <div className="canvas-fallback-notice">
          <AlertTriangle size={18} aria-hidden />
          <div>
            <p className="canvas-fallback-title">{copy.title}</p>
            <p className="canvas-fallback-body">{copy.body}</p>
          </div>
          <button className="ghost" type="button" onClick={this.retry}>
            <RotateCcw size={14} /> Try again
          </button>
        </div>
      </div>
    );
  }
}
