"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Box,
  Camera,
  Check,
  ClipboardCheck,
  CloudSun,
  CircleGauge,
  Cog,
  Expand,
  Lightbulb,
  Loader2,
  Mountain,
  Map,
  PaintBucket,
  RotateCcw,
  Save,
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
import { createConfigurationShareUrl, estimateBuildTotal, readSharedConfigurationId } from "../../lib/showroom/buildTools";

const VEHICLE_SLUG = "4runner";
const DEFAULT_GRADE = "trd-pro";
const STORAGE_KEY = "toyota-showroom:configurationId";
type Terrain = "Studio" | "Trail" | "Night";
type SceneMood = "Day" | "Golden hour" | "Night";

const CATEGORY_LABELS: Record<CustomizationCategory, string> = {
  paint: "Paint",
  wheels: "Wheels",
  hood: "Hood",
  panel: "Body panels",
  decal: "Decals & graphics",
  trim: "Trim",
  accessory: "Accessories",
};

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

export function BuilderApp() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preset, setPreset] = useState<CameraPreset | null>(null);
  const [lift, setLift] = useState(2);
  const [terrain, setTerrain] = useState<Terrain>("Studio");
  const [sceneMood, setSceneMood] = useState<SceneMood>("Day");
  const [activeCategory, setActiveCategory] = useState<CustomizationCategory>("paint");
  const [garageMessage, setGarageMessage] = useState("Changes save automatically");
  const controllerRef = useRef<VehicleSceneController | null>(null);
  const stageRef = useRef<HTMLElement>(null);

  const { configuration, catalog, status, error } = useConfiguration();

  // ------------------------------------------------------------------ step 1-4
  // Load vehicle metadata, then the option catalog, then the saved configuration. Nothing here
  // touches Three.js; the scene is only mutated once the GLB reports its node contract verified.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const vehicle = await getVehicle(VEHICLE_SLUG);
        const gradeId = vehicle.grades.some((grade) => grade.id === DEFAULT_GRADE)
          ? DEFAULT_GRADE
          : (vehicle.grades[0]?.id ?? DEFAULT_GRADE);

        const [options, configuration] = await Promise.all([
          configurationsApi.listVehicleOptions(VEHICLE_SLUG, gradeId),
          resumeOrCreateConfiguration(vehicle, gradeId),
        ]);

        if (cancelled) return;
        setBootstrap({ vehicle, catalog: options, configuration });
        setPreset(vehicle.threeDConfig.cameraPresets[0] ?? null);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      configurationStore.reset();
    };
  }, []);

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
    const flush = () => void configurationStore.flush();
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
  const estimatedTotal = useMemo(() => estimateBuildTotal(startingMsrp(bootstrap?.vehicle ?? null), catalog, configuration), [bootstrap, catalog, configuration]);

  const reset = async () => {
    if (!bootstrap) return;
    const fresh = await configurationsApi.createConfiguration({
      vehicleId: bootstrap.vehicle.slug,
      modelYear: bootstrap.vehicle.year,
      gradeId: bootstrap.configuration.gradeId,
    });
    rememberConfigurationId(fresh.configurationId);
    if (controllerRef.current) {
      await configurationStore.attachScene(controllerRef.current, fresh, catalog);
    }
    setLift(2);
    setPreset(bootstrap.vehicle.threeDConfig.cameraPresets[0] ?? null);
  };

  const saveToGarage = async () => {
    await configurationStore.flush();
    setGarageMessage("Build saved to your local garage");
  };

  const share = async () => {
    if (!configuration) return;
    const url = createConfigurationShareUrl(window.location.origin, window.location.pathname, configuration.configurationId);
    try {
      await navigator.clipboard.writeText(url);
      setGarageMessage("Share link copied to clipboard");
    } catch {
      window.prompt("Copy this build link", url);
      setGarageMessage("Share link ready to copy");
    }
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await stageRef.current?.requestFullscreen();
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
        <p>Loading {VEHICLE_SLUG}&hellip;</p>
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
          <button onClick={() => void saveToGarage()}>Garage</button>
        </nav>
        <div className="top-actions">
          <button className="ghost" onClick={() => void reset()}>
            <RotateCcw size={16} /> Reset
          </button>
          <SaveIndicator status={status} />
          <button className="primary" onClick={() => void share()}>
            <Share2 size={16} /> Share
          </button>
        </div>
      </header>

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
            <p>Estimated ${estimatedTotal.toLocaleString()}</p>
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
          <button className={`rail-item ${activeCategory === "paint" ? "active" : ""}`} onClick={() => setActiveCategory("paint")}><PaintBucket size={18} /> Exterior</button>
          <button className={`rail-item ${activeCategory === "wheels" ? "active" : ""}`} onClick={() => setActiveCategory("wheels")}><CircleGauge size={18} /> Wheels &amp; Tires</button>
          <button className={`rail-item ${activeCategory === "trim" ? "active" : ""}`} onClick={() => setActiveCategory("trim")}><SlidersHorizontal size={18} /> Suspension</button>
          <button className={`rail-item ${activeCategory === "accessory" ? "active" : ""}`} onClick={() => setActiveCategory("accessory")}><Lightbulb size={18} /> Lighting</button>
          <button className={`rail-item ${activeCategory === "panel" ? "active" : ""}`} onClick={() => setActiveCategory("panel")}><Cog size={18} /> Performance</button>
          <button className={`rail-item ${activeCategory === "decal" ? "active" : ""}`} onClick={() => setActiveCategory("decal")}><Box size={18} /> Accessories</button>

          <div className="garage-card"><div><Save size={15} /><span>Garage</span></div><small>{garageMessage}</small><button onClick={() => void saveToGarage()}>Save build</button></div>

          <div className="tech-stack">
            <span>Next.js</span><span>React</span><span>Three.js</span>
            <span>WebGPU</span><span>GSAP</span><span>Drizzle/D1</span>
          </div>
        </aside>

        <section className="stage" ref={stageRef}>
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
              <button title="Fullscreen" onClick={() => void toggleFullscreen()}><Expand size={17} /></button>
            </div>
          </div>

          <VehicleCanvas
            threeDConfig={vehicle.threeDConfig}
            catalog={bootstrap.catalog}
            cameraPreset={preset}
            lift={lift}
            terrain={terrain}
            sceneMood={sceneMood}
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
            <div><span>Configuration</span><h2>{CATEGORY_LABELS[activeCategory]}</h2></div>
            <Mountain size={22} />
          </div>

          {catalog.length === 0 ? (
            <p className="panel-empty">Preparing customization options&hellip;</p>
          ) : null}

          {grouped.filter(({ category }) => category === activeCategory).map(({ category, options }) => (
            <section className="control-section" key={category}>
              <label>{CATEGORY_LABELS[category]}</label>
              <div className={category === "paint" ? "paint-row" : "chip-row"}>
                {options.map((option) => (
                  <CustomizationButton
                    key={option.id}
                    option={option}
                    variant={category === "paint" ? "swatch" : "chip"}
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
          <section className="control-section scene-controls">
            <label><Map size={14} /> Terrain preview</label>
            <div className="segmented">{(["Studio", "Trail", "Night"] as Terrain[]).map((item) => <button key={item} className={terrain === item ? "active" : ""} onClick={() => setTerrain(item)}>{item}</button>)}</div>
            <label><CloudSun size={14} /> Lighting</label>
            <div className="segmented">{(["Day", "Golden hour", "Night"] as SceneMood[]).map((item) => <button key={item} className={sceneMood === item ? "active" : ""} onClick={() => setSceneMood(item)}>{item}</button>)}</div>
          </section>
          <section className="comparison-card"><div><ClipboardCheck size={16} /><strong>Build comparison</strong></div><p><span>Base MSRP</span><b>${startingMsrp(vehicle).toLocaleString()}</b></p><p><span>Configured upgrades</span><b>+${(estimatedTotal - startingMsrp(vehicle)).toLocaleString()}</b></p><p className="total"><span>Estimated total</span><b>${estimatedTotal.toLocaleString()}</b></p></section>
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

function startingMsrp(vehicle: Vehicle | null): number {
  if (!vehicle) return 0;
  return Math.min(vehicle.pricing.baseMsrp, ...vehicle.grades.map((grade) => grade.msrp));
}

function rememberConfigurationId(configurationId: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, configurationId);
  } catch {
    // Private browsing or a full quota is not a reason to fail the build session.
  }
}

/**
 * Resumes the configuration this browser last worked on, or creates a fresh one.
 *
 * Only the *id* is kept client-side; the configuration itself is re-fetched, so the server stays
 * authoritative and a build edited elsewhere shows its latest state here. A stored id that no
 * longer resolves (deleted, or a wiped dev database) falls through to creating a new record rather
 * than leaving the builder stuck on an error.
 */
async function resumeOrCreateConfiguration(vehicle: Vehicle, gradeId: string): Promise<VehicleConfiguration> {
  const storedId = safeReadStoredId();

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
  rememberConfigurationId(created.configurationId);
  return created;
}

function safeReadStoredId(): string | null {
  try {
    return readSharedConfigurationId(window.location.hash) ?? window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
