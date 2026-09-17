"use client";

/**
 * Optional QR share card for the current `?c=` deep link (#50).
 *
 * Lazy-loaded from BuilderApp so `uqr` stays out of the builder chrome chunk. Renders the same
 * deep-link URL Share copies under local/demo persistence — phones open the build without paste.
 */

import { useEffect, useState } from "react";
import { X } from "lucide-react";

type Props = {
  /** Absolute `?c=` deep-link URL (from `createShareQrUrl`). */
  url: string;
  onClose: () => void;
};

export function ShareQrCard({ url, onClose }: Props) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("../../lib/showroom/renderShareQr")
      .then(({ renderShareQrSvg }) => {
        if (cancelled) return;
        setSvg(renderShareQrSvg(url));
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't generate QR code");
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div
      className="share-qr-card"
      role="dialog"
      aria-modal="true"
      aria-label="Share QR code"
      data-testid="share-qr-card"
    >
      <button type="button" className="tour-close" aria-label="Close QR share card" onClick={onClose}>
        <X size={15} />
      </button>
      <strong>Scan to open this build</strong>
      <p>Hand the phone this QR — same deep link as Share copy. Works in local / demo mode without cloud save.</p>
      <div className="share-qr-frame" data-testid="share-qr-frame" aria-hidden={svg ? undefined : true}>
        {svg ? (
          <div className="share-qr-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : error ? (
          <p className="share-qr-error" role="status">
            {error}
          </p>
        ) : (
          <p className="share-qr-loading" role="status">
            Generating QR&hellip;
          </p>
        )}
      </div>
      <p className="share-qr-url" title={url} data-testid="share-qr-url">
        {url}
      </p>
    </div>
  );
}
