"use client";

import { Component, Fragment, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import type { MediaAsset } from "../../lib/types/vehicle";

/**
 * Keeps a failed 3D stage from taking the whole page with it.
 *
 * `VehicleCanvas` already handles the failures it can see coming — a GLB that will not fetch or
 * decode falls back to a procedural vehicle inside its own try/catch. What it cannot handle is
 * anything that throws during *render*, because at that point React unmounts the tree and, with no
 * boundary above it, that means the entire route. The realistic causes are not exotic:
 *
 *   - **Chunk load failure.** `VehicleCanvas` is `lazy()`-imported, and a deploy that replaces
 *     hashed assets while someone has the page open makes their next chunk fetch 404. Very common,
 *     and entirely invisible in testing.
 *   - **No GPU adapter.** `createRenderer` requests WebGPU and falls back to WebGL2, but a machine
 *     or hardened browser profile with neither leaves nothing to fall back to.
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
 * A class component because React has no hook equivalent: `componentDidCatch` and
 * `getDerivedStateFromError` are the only error-boundary API.
 */

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

    return (
      <div className="vehicle-canvas canvas-fallback" role="alert">
        {fallbackImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- static export; no image optimizer.
          <img className="canvas-fallback-image" src={fallbackImage.url} alt={fallbackImage.alt} />
        ) : null}
        <div className="canvas-fallback-notice">
          <AlertTriangle size={18} />
          <div>
            <p className="canvas-fallback-title">Interactive view unavailable</p>
            <p className="canvas-fallback-body">
              Showing a static image instead. Every configuration option below still works.
            </p>
          </div>
          <button className="ghost" type="button" onClick={this.retry}>
            <RotateCcw size={14} /> Try again
          </button>
        </div>
      </div>
    );
  }
}
