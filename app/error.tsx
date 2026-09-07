"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * Route-level error boundary.
 *
 * The App Router renders this in place of the page when a client component below it throws during
 * render. There was no such file before, so any uncaught render error produced a blank document —
 * the worst version of a failure, because it looks identical to a broken deploy and gives the user
 * nothing to act on.
 *
 * `reset()` re-renders the segment without a full page load, which is the right first move here:
 * this app's most likely errors are transient (a failed chunk fetch after a deploy, a catalog
 * request that timed out), and re-mounting is usually enough. The reload link is the escape hatch
 * for when it is not — after a deploy, a hard load is what actually fetches the new chunk manifest.
 *
 * `app/components/CanvasErrorBoundary.tsx` deliberately sits below this one: a 3D failure should
 * cost the viewport and leave the configurator usable, so it must be caught before it reaches here.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // `digest` is the server-side error's hash — the only correlation handle between what the user
    // saw and what the logs recorded, so it is logged even though the message may be redacted.
    console.error("[route] unhandled error", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <main className="route-error" role="alert">
      <AlertTriangle size={28} />
      <h1>Something went wrong</h1>
      <p>
        The showroom hit an unexpected error. Trying again usually clears it — if the site was
        updated while this page was open, a full reload will pick up the new version.
      </p>
      {error.digest ? <p className="route-error-digest">Reference: {error.digest}</p> : null}
      <div className="route-error-actions">
        <button className="primary" type="button" onClick={reset}>
          <RotateCcw size={16} /> Try again
        </button>
        <a className="ghost" href="/">
          Back to the showroom
        </a>
      </div>
    </main>
  );
}
