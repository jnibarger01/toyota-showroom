"use client";

import { useEffect, useRef, useState } from "react";
import { Move3d, RotateCcw } from "lucide-react";
import type { ExteriorSpin } from "../../lib/types/spin";

type Props = {
  spin: ExteriorSpin;
  vehicleLabel: string;
  posterUrl?: string;
  onRequest3D: () => void;
};

function wrapped(index: number, frameCount: number): number {
  return ((index % frameCount) + frameCount) % frameCount;
}

export function VehicleSpin({ spin, vehicleLabel, posterUrl, onRequest3D }: Props) {
  const [frame, setFrame] = useState(0);
  const [failedFrameKey, setFailedFrameKey] = useState<string | null>(null);
  const drag = useRef<{ pointerId: number; x: number; frame: number } | null>(null);

  useEffect(() => {
    if (typeof Image === "undefined") return;
    for (const offset of [-2, -1, 0, 1, 2]) {
      const image = new Image();
      image.decoding = "async";
      image.src = spin.frames[wrapped(frame + offset, spin.frameCount)]!.url;
    }
  }, [frame, spin]);

  const step = (delta: number) => setFrame((current) => wrapped(current + delta, spin.frameCount));
  const frameAsset = spin.frames[frame]!;
  const frameKey = `${spin.id}:${frame}`;

  return (
    <div
      className="vehicle-spin"
      data-testid="vehicle-spin"
      role="slider"
      tabIndex={0}
      aria-label={`${vehicleLabel} exterior 360 degree view`}
      aria-valuemin={0}
      aria-valuemax={spin.frameCount - 1}
      aria-valuenow={frame}
      aria-valuetext={`${frame * spin.degreesPerFrame} degrees`}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          step(-1);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          step(1);
        } else if (event.key === "Home") {
          event.preventDefault();
          setFrame(0);
        }
      }}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return;
        drag.current = { pointerId: event.pointerId, x: event.clientX, frame };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) return;
        const frameDelta = Math.round((event.clientX - active.x) / 18);
        setFrame(wrapped(active.frame - frameDelta, spin.frameCount));
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId === event.pointerId) drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a 24-frame sequence needs direct URL swaps without image optimization churn */}
      <img
        src={failedFrameKey === frameKey && posterUrl ? posterUrl : frameAsset.url}
        alt={`${vehicleLabel}, exterior view at ${frame * spin.degreesPerFrame} degrees`}
        draggable={false}
        onError={() => setFailedFrameKey(frameKey)}
      />
      <div className="spin-mode-badge">Exterior 360°</div>
      <div className="spin-controls">
        <button type="button" onClick={() => setFrame(0)} title="Front view">
          <RotateCcw size={15} aria-hidden /> Front
        </button>
        <span aria-live="polite">View {frame + 1} / {spin.frameCount}</span>
        <button type="button" data-testid="explore-in-3d" onClick={onRequest3D}>
          <Move3d size={15} aria-hidden /> Explore in 3D
        </button>
      </div>
    </div>
  );
}