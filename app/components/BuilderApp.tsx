"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Box,
  Camera,
  Check,
  CircleGauge,
  Cog,
  Expand,
  Lightbulb,
  Loader2,
  Mountain,
  PaintBucket,
  RotateCcw,
  Settings2,
  Share2,
  SlidersHorizontal,
  Truck,
  ZoomIn,
} from "lucide-react";
import { VehicleCanvas, type CameraPreset } from "./VehicleCanvas";
import { CustomizationButton } from "./CustomizationButton";
import { getVehicle } from "../../lib/api/client";
import * as configurationsApi from "../../lib/api/configurations";
import { configurationStore, useConfiguration } from "../../lib/state/useConfiguration";
import type { Vehicle } from "../../lib/types/vehicle";
import {
  CATEGORY_APPLY_ORDER,
  type CustomizationCategory,
  type CustomizationOption,
  type VehicleConfiguration,
} from "../../lib/types/customization";
import type { VehicleSceneController } from "../../lib/three/sceneController";

/** Used only when no `vehicleSlug` prop is given — the root route's implicit default vehicle. */
const DEFAULT_VEHICLE_SLUG = "4runner";
const DEFAULT_GRADE = "trd-pro";

function storageKeyFor(vehicleSlug: string): string {
  // Scoped per vehicle so switching vehicles doesn't clobber (or try to resume) another vehicle's
  // remembered configuration id — each route keeps its own "last worked on" pointer independently.
  return `toyota-showroom:configurationId:${vehicleSlug}`;
}

const CATEGORY_LABELS: Record<CustomizationCategory, string> = {
  paint: "Paint",
  wheels: "Wheels",
  hood: "Hood",
  panel: "Body panels",
  decal: "Decals & graphics",
  trim: "Trim",
  accessory: "Accessories",
  interior: "Interior",
};

/** Categories rendered as circular colour swatches rather than text chips. */
const SWATCH_CATEGORIES: ReadonlySet<CustomizationCategory> = new Set(["paint", "interior"]);

/**
 * Bootstrap data resolved before the scene is touched.
 *
 * Holding the vehicle, catalog, and configuration together in one state transition is what removes
 * the race between the three async sources: the canvas is not rendered at all until all three are
 * present, so there is no window in which a control exists but the scene cannot honour it.
 */
type Bootstrap = {
  vehicle: Vehicle;
  catalog: CustomizationOption[];
  configuration: VehicleConfiguration;
};

type Props = {
  /** Defaults to the site's implicit default vehicle when the route doesn't name one (`/`). */
  vehicleSlug?: string;
};

export function BuilderApp({ vehicleSlug = DEFAULT_VEHICLE_SLUG }: Props) {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preset, setPreset] = useState<CameraPreset | null>(null);
  const [lift, setLift] = useState(2);
  const controllerRef = useRef<VehicleSceneController | null>(null);

  const { configuration, catalog, status, error } = useConfiguration();

  // ------------------------------------------------------------------ step 1-4
  // Load vehicle metadata, then the option catalog, then the saved configuration. Nothing here
  // touches Three.js; the scene is only mutated once the GLB reports its node contract verified.
  //
  // The App Router does not remount a page component just because a route param changed under the
  // same `[slug]` segment, so `app/[slug]/page.tsx` forces a clean remount on vehicle switches with
  // `key={slug}` rather than this effect resetting state imperatively (setState synchronously at the
  // top of an effect body causes an extra render pass React's own lint rules flag against). Every
  // field this effect writes therefore starts at its `useState` initial value on each new vehicle.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const vehicle = await getVehicle(vehicleSlug);
        const gradeId = vehicle.grades.some((grade) => grade.id === DEFAULT_GRADE)
          ? DEFAULT_GRADE
          : (vehicle.grades[0]?.id ?? DEFAULT_GRADE);

        const [options, configuration] = await Promise.all([
          configurationsApi.listVehicleOptions(vehicleSlug, gradeId),
          resumeOrCreateConfiguration(vehicle, gradeId),
        ]);

        if (cancelled) return;
        setBootstrap({ vehicle, catalog: options, configuration });
        setPreset(presetForConfiguration(vehicle, configuration));
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      configurationStore.reset();
    };
  }, [vehicleSlug]);

  // ------------------------------------------------------------------ step 5-7
  // Called by the canvas after the base GLB loads and `verifyNodeContract` runs. Saved selections
  // are applied here, in deterministic category order, before any control is interactive.
  const handleSceneReady = useCallback(
    (controller: VehicleSceneController, applicable: CustomizationOption[]) => {
      controllerRef.current = controller;
      if (!bootstrap) return;
      void configurationStore.attachScene(controller, bootstrap.configuration, applicable);
    },
    [bootstrap],
  );

  const handleSceneError = useCallback((message: string) => setLoadError(message), []);

  // Persist any pending batch before the tab goes away, so a refresh cannot lose the last click.
  useEffect(() => {
    // `keepalive` lets the PATCH outlive the document; a plain fetch started during unload can be
    // aborted by the browser, losing a click made inside the debounce window.
    const flush = () => void configurationStore.flush({ keepalive: true });
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  const grouped = useMemo(
    () =>
      CATEGORY_APPLY_ORDER.map((category) => ({
        category,
        options: catalog.filter((option) => option.category === category),
      })).filter((group) => group.options.length > 0),
    [catalog],
  );

  const installedCount = useMemo(() => {
    if (!configuration) return 0;
    return (configuration.selections.accessory ?? []).length + (configuration.selections.decal ?? []).length;
  }, [configuration]);

  const reset = async () => {
    if (!bootstrap) return;
    const fresh = await configurationsApi.createConfiguration({
      vehicleId: bootstrap.vehicle.slug,
      modelYear: bootstrap.vehicle.year,
      gradeId: bootstrap.configuration.gradeId,
    });
    rememberConfigurationId(vehicleSlug, fresh.configurationId);
    if (controllerRef.current) {
      await configurationStore.attachScene(controllerRef.current, fresh, catalog);
    }
    setLift(2);
    setPreset(bootstrap.vehicle.threeDConfig.cameraPresets[0] ?? null);
  };

  if (loadError && !bootstrap) {
    return (
      <main className="builder-shell builder-status">
        <p>Couldn&rsquo;t load the builder: {loadError}</p>
      </main>
    );
  }

  if (!bootstrap || !preset) {
    return (
      <main className="builder-shell builder-status">
        <p>Loading {vehicleSlug}&hellip;</p>
      </main>
    );
  }

  const { vehicle } = bootstrap;
  const cameraPresets = vehicle.threeDConfig.cameraPresets;

  return (
    <main className="builder-shell">
      <header className="topbar">
        <div className="brand">
          <Truck size={24} />
          <div>
            <strong>{vehicle.model.toUpperCase()}</strong>
            <span>WEBGPU BUILDER</span>
          </div>
        </div>
        <nav>
          <button className="active">Build</button>
          <button>Explore</button>
          <button>Garage</button>
        </nav>
        <div className="top-actions">
          <button className="ghost" onClick={() => void reset()}>
            <RotateCcw size={16} /> Reset
          </button>
          <SaveIndicator status={status} />
          <button className="primary">
            <Share2 size={16} /> Share
          </button>
        </div>
      </header>

      {/*
        `loadError` is also set by VehicleCanvas *after* bootstrap — a renderer failure or a GLB
        that fell back to the simplified model. Rendering it only in the pre-bootstrap branch would
        leave those failures invisible, which is exactly the silent-degradation this integration is
        meant to remove.
      */}
      {loadError ? (
        <div className="config-error" role="alert">
          <AlertTriangle size={15} />
          <span>{loadError}</span>
          <button onClick={() => setLoadError(null)}>Dismiss</button>
        </div>
      ) : null}

      {error ? (
        <div className="config-error" role="alert">
          <AlertTriangle size={15} />
          <span>{error}</span>
          <button onClick={() => configurationStore.clearError()}>Dismiss</button>
        </div>
      ) : null}

      <section className="workspace">
        <aside className="left-rail">
          <div className="vehicle-title">
            <span>{vehicle.year} TOYOTA</span>
            <h1>{vehicle.model}</h1>
            <p>Starting at ${startingMsrp(vehicle).toLocaleString()}</p>
          </div>

          <div className="summary">
            <div>
              <span>Installed</span>
              <strong>{installedCount}</strong>
            </div>
            <div>
              <span>Lift</span>
              <strong>{lift}&quot;</strong>
            </div>
            <div>
              <span>Revision</span>
              <strong>{configuration?.revision ?? "—"}</strong>
            </div>
          </div>

          <div className="section-label">Systems</div>
          <button className="rail-item active"><PaintBucket size={18} /> Exterior</button>
          <button className="rail-item"><CircleGauge size={18} /> Wheels &amp; Tires</button>
          <button className="rail-item"><SlidersHorizontal size={18} /> Suspension</button>
          <button className="rail-item"><Lightbulb size={18} /> Lighting</button>
          <button className="rail-item"><Cog size={18} /> Performance</button>
          <button className="rail-item"><Box size={18} /> Accessories</button>

          <div className="tech-stack">
            <span>Next.js</span><span>React</span><span>Three.js</span>
            <span>WebGPU</span><span>GSAP</span><span>Drizzle/D1</span>
          </div>
        </aside>

        <section className="stage">
          <div className="stage-toolbar">
            <div className="camera-group">
              <Camera size={16} />
              {cameraPresets.map((item) => (
                <button
                  key={item.id}
                  className={preset.id === item.id ? "selected" : ""}
                  onClick={() => {
                    setPreset(item);
                    configurationStore.setCameraState({
                      presetId: item.id,
                      position: item.position,
                      target: item.target,
                    });
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="viewport-actions">
              <button title="Zoom"><ZoomIn size={17} /></button>
              <button title="Settings"><Settings2 size={17} /></button>
              <button title="Fullscreen"><Expand size={17} /></button>
            </div>
          </div>

          <VehicleCanvas
            threeDConfig={vehicle.threeDConfig}
            catalog={bootstrap.catalog}
            cameraPreset={preset}
            lift={lift}
            onReady={handleSceneReady}
            onError={handleSceneError}
          />

          <div className="gpu-status">
            <span><i /> WebGPU preferred</span>
            <small>Assembled 4Runner asset · WebGL fallback ready</small>
          </div>
        </section>

        <aside className="right-panel">
          <div className="panel-title">
            <div><span>Configuration</span><h2>Exterior</h2></div>
            <Mountain size={22} />
          </div>

          {catalog.length === 0 ? (
            <p className="panel-empty">Preparing customization options&hellip;</p>
          ) : null}

          {grouped.map(({ category, options }) => (
            <section className="control-section" key={category}>
              <label>{CATEGORY_LABELS[category]}</label>
              <div className={SWATCH_CATEGORIES.has(category) ? "paint-row" : "chip-row"}>
                {options.map((option) => (
                  <CustomizationButton
                    key={option.id}
                    option={option}
                    variant={SWATCH_CATEGORIES.has(category) ? "swatch" : "chip"}
                  />
                ))}
              </div>
            </section>
          ))}

          <section className="control-section">
            <label>Lift height</label>
            <div className="segmented">
              {[0, 1, 2, 3].map((value) => (
                <button
                  key={value}
                  className={lift === value ? "active" : ""}
                  onClick={() => setLift(value)}
                >
                  {value}&quot;
                </button>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

function SaveIndicator({ status }: { status: string }) {
  if (status === "saving") {
    return <button className="ghost" disabled><Loader2 size={16} className="spin" /> Saving</button>;
  }
  if (status === "error") {
    return <button className="ghost" disabled><AlertTriangle size={16} /> Not saved</button>;
  }
  if (status === "saved") {
    return <button className="ghost" disabled><Check size={16} /> Saved</button>;
  }
  return <button className="ghost" disabled><Check size={16} /> Up to date</button>;
}

function startingMsrp(vehicle: Vehicle): number {
  return Math.min(vehicle.pricing.baseMsrp, ...vehicle.grades.map((grade) => grade.msrp));
}

/**
 * Resolves the camera a resumed configuration should open with.
 *
 * A saved `cameraState` is honoured over the vehicle's first preset, otherwise choosing and saving
 * a camera angle would appear to work until the next refresh. A stored `presetId` is preferred so
 * the matching toolbar button reads as selected; a configuration saved from a free orbit falls back
 * to its raw position and target.
 */
export function presetForConfiguration(
  vehicle: Vehicle,
  configuration: VehicleConfiguration,
): CameraPreset | null {
  const presets = vehicle.threeDConfig.cameraPresets;
  const saved = configuration.cameraState;
  if (!saved) return presets[0] ?? null;

  const matching = presets.find((preset) => preset.id === saved.presetId);
  if (matching) return matching;

  return { id: saved.presetId ?? "saved", label: "Saved", position: saved.position, target: saved.target };
}

function rememberConfigurationId(vehicleSlug: string, configurationId: string): void {
  try {
    window.localStorage.setItem(storageKeyFor(vehicleSlug), configurationId);
  } catch {
    // Private browsing or a full quota is not a reason to fail the build session.
  }
}

/**
 * Resumes the configuration this browser last worked on for this vehicle, or creates a fresh one.
 *
 * Only the *id* is kept client-side; the configuration itself is re-fetched, so the server stays
 * authoritative and a build edited elsewhere shows its latest state here. A stored id that no
 * longer resolves (deleted, or a wiped dev database) falls through to creating a new record rather
 * than leaving the builder stuck on an error. The vehicle-id check also guards against a corrupted
 * or hand-edited storage value pointing at the wrong vehicle.
 */
async function resumeOrCreateConfiguration(vehicle: Vehicle, gradeId: string): Promise<VehicleConfiguration> {
  const storedId = safeReadStoredId(vehicle.slug);

  if (storedId) {
    try {
      const existing = await configurationsApi.getConfiguration(storedId);
      if (existing.vehicleId === vehicle.slug) return existing;
    } catch {
      // Fall through to creating a new configuration.
    }
  }

  const created = await configurationsApi.createConfiguration({
    vehicleId: vehicle.slug,
    modelYear: vehicle.year,
    gradeId,
  });
  rememberConfigurationId(vehicle.slug, created.configurationId);
  return created;
}

function safeReadStoredId(vehicleSlug: string): string | null {
  try {
    return window.localStorage.getItem(storageKeyFor(vehicleSlug));
  } catch {
    return null;
  }
}
