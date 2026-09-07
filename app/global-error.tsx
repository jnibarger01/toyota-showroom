"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary, for errors thrown by the root layout itself.
 *
 * `app/error.tsx` is rendered *inside* the root layout, so it cannot catch a failure in the layout
 * that would host it. This one replaces the entire document instead — which is why it ships its own
 * `<html>` and `<body>`, the only place in the App Router where a component does that.
 *
 * It should effectively never render. That is precisely the argument for its existence: the
 * alternative in the case it covers is a blank page with no diagnostic at all, and this is the only
 * mechanism that can say anything once the layout is the thing that broke.
 *
 * Styling is inline rather than from `globals.css`. If the layout failed, the reason may well be
 * that its stylesheet import failed, and a fallback that depends on the thing that broke is not a
 * fallback.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global] root layout error", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeContent: "center",
          gap: "12px",
          padding: "24px",
          textAlign: "center",
          background: "#0b0f14",
          color: "#e6ebf2",
          font: "14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "20px" }}>The showroom failed to load</h1>
        <p style={{ margin: 0, color: "#93a0b0", maxWidth: "44ch" }}>
          Something went wrong before the page could start. Reloading usually resolves it.
        </p>
        {error.digest ? (
          <p style={{ margin: 0, color: "#6c7a8a", fontSize: "12px" }}>Reference: {error.digest}</p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          style={{
            justifySelf: "center",
            padding: "9px 18px",
            border: "1px solid #eb0a1e",
            borderRadius: "8px",
            background: "#eb0a1e",
            color: "#fff",
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
