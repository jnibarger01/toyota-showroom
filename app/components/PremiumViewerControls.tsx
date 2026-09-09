"use client";

import { useEffect, useState } from "react";
import { Minus, Plus, Rotate3D, RotateCcw } from "lucide-react";
import { dispatchViewerControl, subscribeViewerState } from "../../lib/three/viewerControlEvents";
import styles from "./PremiumViewerControls.module.css";

export function PremiumViewerControls() {
  const [autoRotate, setAutoRotate] = useState(false);

  useEffect(() => subscribeViewerState((state) => setAutoRotate(state.autoRotate)), []);

  return (
    <div className={styles.dock} role="group" aria-label="3D viewer controls">
      <button
        type="button"
        className={`${styles.control} ${autoRotate ? styles.active : ""}`}
        aria-pressed={autoRotate}
        title={autoRotate ? "Stop auto-rotate" : "Start auto-rotate"}
        onClick={() => dispatchViewerControl("toggle-auto-rotate")}
      >
        <Rotate3D size={17} aria-hidden />
        <span>Rotate</span>
      </button>
      <span className={styles.divider} aria-hidden />
      <button type="button" className={styles.iconControl} aria-label="Zoom out" title="Zoom out" onClick={() => dispatchViewerControl("zoom-out")}>
        <Minus size={18} aria-hidden />
      </button>
      <button type="button" className={styles.iconControl} aria-label="Zoom in" title="Zoom in" onClick={() => dispatchViewerControl("zoom-in")}>
        <Plus size={18} aria-hidden />
      </button>
      <button type="button" className={styles.iconControl} aria-label="Reset camera" title="Reset camera" onClick={() => dispatchViewerControl("reset-camera")}>
        <RotateCcw size={17} aria-hidden />
      </button>
    </div>
  );
}
