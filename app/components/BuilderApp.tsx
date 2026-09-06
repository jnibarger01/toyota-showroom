"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Armchair,
  Box,
  Camera,
  Check,
  ClipboardCheck,
  Download,
  CloudSun,
  CircleGauge,
  Cog,
  Expand,
  Landmark,
  Lightbulb,
  Loader2,
  Mountain,
  Map,
  PaintBucket,
  RotateCcw,
  Search,
  Shuffle,
  Save,
  Settings2,
  Share2,
  SlidersHorizontal,
  Truck,
  Undo2,
  Redo2,
  Printer,
  X,
  ZoomIn,
} from "lucide-react";
import type { CameraPreset } from "./VehicleCanvas";
import { CustomizationButton } from "./CustomizationButton";
import { getVehicle, pageUrl } from "../../lib/api/client";
import * as configurationsApi from "../../lib/api/configurations";
import { configurationStore, useConfiguration } from "../../lib/state/useConfiguration";
import { isOptionAvailableForGrade } from "../../lib/data/options";
import type { Vehicle } from "../../lib/types/vehicle";
import {
  CATEGORY_APPLY_ORDER,
  type CustomizationCategory,
  type CustomizationOption,
  type SelectionMap,
  type VehicleConfiguration,
} from "../../lib/types/customization";
import type { VehicleSceneController } from "../../lib/three/sceneController";
import {
  calculateBuildProgress,
  createRandomSelections,
  estimateBuildTotal,
  estimateMonthlyPayment,
  resolveGradeMsrp,
  filterBuildOptions,
  formatBuildSummary,
  readSharedConfigurationId,
} from "../../lib/showroom/buildTools";
import {
  createBuildDeepLinkUrl,
  readBuildDeepLinkParam,
  validateBuildDeepLink,
} from "../../lib/showroom/deepLink";

/**
 * Three.js (core + the WebGPU renderer + loaders + gsap) is the single heaviest dependency this
 * app ships — split into its own chunk so `/explore` and `/compare`, which never render a canvas,
 * don't pay to parse it, and so this page's own chrome (header, rail, right panel) can paint and
 * become interactive before that chunk finishes downloading.
 */
const VehicleCanvas = lazy(() => import("./VehicleCanvas").then((module) => ({ default: module.VehicleCanvas })));

/** Used only when no `vehicleSlug` prop is given — the root route's implicit default vehicle. */
const DEFAULT_VEHICLE_SLUG = "4runner";
const DEFAULT_GRADE = "trd-pro";
function storageKeyFor(vehicleSlug: string): string {
  // Scoped per vehicle so switching vehicles doesn't clobber (or try to resume) another vehicle's
  // remembered configuration id — each route keeps its own "last worked on" pointer independently.
  return `toyota-showroom:configurationId:${vehicleSlug}`;
}

type Terrain = "Studio" | "Trail" | "Night";
type EnvironmentPreset = "Daytime" | "Sunset" | "Night";

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
  const [lift, setLift] = useState(0);
  const [gradeChanging, setGradeChanging] = useState(false);
  const [terrain, setTerrain] = useState<Terrain>("Studio");
  const [environmentPreset, setEnvironmentPreset] = useState<EnvironmentPreset>("Daytime");
  const [activeCategory, setActiveCategory] = useState<CustomizationCategory>("paint");
  const [garageMessage, setGarageMessage] = useState("Changes save automatically");
  const [optionQuery, setOptionQuery] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [budget, setBudget] = useState(65_000);
  const [downPayment, setDownPayment] = useState(0);
  const [apr, setApr] = useState(6.9);
  const [termMonths, setTermMonths] = useState(60);
  const [historyAvailability, setHistoryAvailability] = useState({ canUndo: false, canRedo: false });
  const [tourOpen, setTourOpen] = useState(false);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const controllerRef = useRef<VehicleSceneController | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  // The full, grade-independent set of options this GLB can satisfy — captured once from
  // `onReady` (§ handleSceneReady) so a grade switch can recompute which options apply without
  // reloading the model or re-running `verifyNodeContract`.
  const fullApplicableRef = useRef<CustomizationOption[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const undoStack = useRef<SelectionMap[]>([]);
  const redoStack = useRef<SelectionMap[]>([]);

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

        // Ungraded: the full catalog, not filtered to `gradeId`. This is what gets handed to
        // `VehicleCanvas` for node-contract verification, so the scene controller it builds knows
        // about every option this GLB can satisfy across every grade — required for `changeGrade`
        // below to switch grades without reloading the model.
        const [options, configuration] = await Promise.all([
          configurationsApi.listVehicleOptions(vehicleSlug),
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
      fullApplicableRef.current = applicable;
      if (!bootstrap) return;
      const forGrade = applicable.filter((option) =>
        isOptionAvailableForGrade(option, bootstrap.configuration.gradeId),
      );
      void configurationStore.attachScene(controller, bootstrap.configuration, forGrade);
    },
    [bootstrap],
  );

  const handleSceneError = useCallback((message: string) => setLoadError(message), []);

  /**
   * Switches the active grade. `gradeId` is immutable on a persisted configuration (the server
   * only accepts it at creation — see `docs/INTEGRATION_GUIDE.md` §5), so this creates a new
   * configuration rather than patching the current one, the same way `reset()` does.
   *
   * Selections that are no longer compatible with the new grade (a TRD Pro-only paint, a
   * Limited-only interior) are dropped before the new configuration is created; `attachScene`'s
   * `applyConfiguration` then resets every writable slot on the live scene and replays only what
   * survived, so the 3D view can never show a selection the new grade doesn't actually offer.
   */
  const changeGrade = async (gradeId: string) => {
    if (!bootstrap || !controllerRef.current || !configuration) return;
    if (gradeId === configuration.gradeId) return;

    setGradeChanging(true);
    try {
      const forGrade = fullApplicableRef.current.filter((option) =>
        isOptionAvailableForGrade(option, gradeId),
      );
      const forGradeIds = new Set(forGrade.map((option) => option.id));

      const carried: SelectionMap = {};
      for (const category of CATEGORY_APPLY_ORDER) {
        const ids = (configuration.selections[category] ?? []).filter((id) => forGradeIds.has(id));
        if (ids.length > 0) carried[category] = ids;
      }

      const fresh = await configurationsApi.createConfiguration({
        vehicleId: bootstrap.vehicle.slug,
        modelYear: bootstrap.vehicle.year,
        gradeId,
        selections: carried,
        cameraState: configuration.cameraState,
      });
      rememberConfigurationId(vehicleSlug, fresh.configurationId);
      setBootstrap({ ...bootstrap, configuration: fresh });
      await configurationStore.attachScene(controllerRef.current, fresh, forGrade);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setGradeChanging(false);
    }
  };

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
  const selectedIds = useMemo(() => new Set(Object.values(configuration?.selections ?? {}).flat()), [configuration]);
  const visibleCatalog = useMemo(
    () => filterBuildOptions(catalog, optionQuery, selectedIds, selectedOnly),
    [catalog, optionQuery, selectedIds, selectedOnly],
  );
  const visibleGrouped = useMemo(
    () => grouped.map((group) => ({ ...group, options: group.options.filter((option) => visibleCatalog.includes(option)) })),
    [grouped, visibleCatalog],
  );

  const selectedGrade = useMemo(
    () => bootstrap?.vehicle.grades.find((grade) => grade.id === configuration?.gradeId),
    [bootstrap, configuration],
  );

  const installedCount = useMemo(() => {
    if (!configuration) return 0;
    return (configuration.selections.accessory ?? []).length + (configuration.selections.decal ?? []).length;
  }, [configuration]);
  // Grade sticker + selected option deltas — re-derived whenever selections/grade/catalog change,
  // including after localConfigurationTransport / deep-link restore. Never a stored dollar field.
  const baseMsrp = useMemo(
    () => resolveGradeMsrp(bootstrap?.vehicle, configuration?.gradeId),
    [bootstrap, configuration?.gradeId],
  );
  const estimatedTotal = useMemo(
    () => estimateBuildTotal(baseMsrp, catalog, configuration),
    [baseMsrp, catalog, configuration],
  );
  const buildProgress = calculateBuildProgress(configuration);
  const overBudget = estimatedTotal > budget;
  // A page-local preview, like `lift`/`terrain` above — not part of the persisted
  // `VehicleConfiguration` (lib/types/customization.ts), same reasoning: this is a what-if
  // calculator over the current estimate, not a saved customization.
  // Clamp during render so principal/payment stay coherent when the live total drops below
  // the stored down payment (e.g. options removed / cheaper grade) — no setState-in-effect.
  const effectiveDownPayment = Math.min(downPayment, estimatedTotal);
  const financedPrincipal = Math.max(0, estimatedTotal - effectiveDownPayment);
  const estimatedMonthlyPayment = useMemo(
    () => estimateMonthlyPayment(financedPrincipal, apr, termMonths),
    [financedPrincipal, apr, termMonths],
  );

  const rememberHistory = useCallback(() => {
    if (!configuration) return;
    undoStack.current.push(structuredClone(configuration.selections));
    redoStack.current = [];
    setHistoryAvailability({ canUndo: true, canRedo: false });
  }, [configuration]);

  const restoreHistory = useCallback(async (direction: "undo" | "redo") => {
    if (!configuration) return;
    const source = direction === "undo" ? undoStack.current : redoStack.current;
    const target = direction === "undo" ? redoStack.current : undoStack.current;
    const selections = source.pop();
    if (!selections) return;
    target.push(structuredClone(configuration.selections));
    setHistoryAvailability({ canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0 });
    await configurationStore.replaceSelections(selections);
  }, [configuration]);

  const surpriseMe = useCallback(async () => {
    if (!configuration) return;
    rememberHistory();
    await configurationStore.replaceSelections(createRandomSelections(catalog));
    setGarageMessage("A surprise build is ready");
  }, [catalog, configuration, rememberHistory]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setTourOpen(!window.localStorage.getItem("toyota-showroom:tour-seen"));
      } catch {
        // Storage is optional; do not interrupt the builder to show onboarding.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const downloadSummary = useCallback(() => {
    if (!configuration || !bootstrap) return;
    const text = formatBuildSummary(`${bootstrap.vehicle.year} Toyota ${bootstrap.vehicle.model}`, resolveGradeMsrp(bootstrap.vehicle, configuration.gradeId), catalog, configuration);
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `toyota-${bootstrap.vehicle.slug}-${configuration.configurationId}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [bootstrap, catalog, configuration]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.key === "/" && !editing) {
        event.preventDefault();
        searchRef.current?.focus();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void restoreHistory(event.shiftKey ? "redo" : "undo");
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        void restoreHistory("redo");
      } else if (event.key === "Escape") {
        setMobilePanelOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [restoreHistory]);

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
    setEnvironmentPreset("Daytime");
    setPreset(bootstrap.vehicle.threeDConfig.cameraPresets[0] ?? null);
    undoStack.current = [];
    redoStack.current = [];
    setHistoryAvailability({ canUndo: false, canRedo: false });
  };

  const saveToGarage = async () => {
    await configurationStore.flush();
    setGarageMessage("Build saved to your local garage");
  };

  const share = async () => {
    if (!configuration) return;
    // Encode selections + camera into `?c=…` so the link restores without a D1/localStorage id.
    const url = createBuildDeepLinkUrl(window.location.origin, window.location.pathname, {
      gradeId: configuration.gradeId,
      selections: configuration.selections,
      cameraState: configuration.cameraState,
    });
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
          <button onClick={() => window.location.assign(pageUrl("explore"))}>Explore</button>
          <button onClick={() => void saveToGarage()}>Garage</button>
        </nav>
        <div className="top-actions">
          <button className="ghost icon-action" title="Undo (Ctrl/⌘ Z)" disabled={!historyAvailability.canUndo} onClick={() => void restoreHistory("undo")}><Undo2 size={16} /></button>
          <button className="ghost icon-action" title="Redo (Ctrl/⌘ Shift Z)" disabled={!historyAvailability.canRedo} onClick={() => void restoreHistory("redo")}><Redo2 size={16} /></button>
          <button className="ghost" onClick={() => void reset()}>
            <RotateCcw size={16} /> Reset
          </button>
          <SaveIndicator status={status} />
          <button className="primary" onClick={() => void share()}>
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
      {tourOpen ? <div className="tour-card" role="dialog" aria-label="Builder tour"><button className="tour-close" aria-label="Close tour" onClick={() => { setTourOpen(false); try { window.localStorage.setItem("toyota-showroom:tour-seen", "1"); } catch { /* optional */ } }}><X size={15} /></button><strong>Build your 4Runner</strong><p>Choose a system, search options, watch your budget, then save or share. Press <kbd>/</kbd> to search and <kbd>Ctrl Z</kbd> to undo.</p></div> : null}

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
            <p>
              {selectedGrade ? `${selectedGrade.name} · ` : ""}Estimated ${estimatedTotal.toLocaleString()}
            </p>
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
          <div className="build-progress"><span><b>Build progress</b><b>{buildProgress}%</b></span><i><b style={{ width: `${buildProgress}%` }} /></i></div>

          <div className="section-label">Grade</div>
          <div className="grade-row">
            {vehicle.grades.map((grade) => (
              <button
                key={grade.id}
                className={grade.id === configuration?.gradeId ? "grade-item active" : "grade-item"}
                disabled={gradeChanging || !configuration}
                onClick={() => void changeGrade(grade.id)}
              >
                <span>{grade.name}</span>
                <small>${grade.msrp.toLocaleString()}</small>
              </button>
            ))}
          </div>

          <div className="section-label">Systems</div>
          <button className={`rail-item ${activeCategory === "paint" ? "active" : ""}`} onClick={() => setActiveCategory("paint")}><PaintBucket size={18} /> Exterior</button>
          <button className={`rail-item ${activeCategory === "wheels" ? "active" : ""}`} onClick={() => setActiveCategory("wheels")}><CircleGauge size={18} /> Wheels &amp; Tires</button>
          <button className={`rail-item ${activeCategory === "trim" ? "active" : ""}`} onClick={() => setActiveCategory("trim")}><SlidersHorizontal size={18} /> Suspension</button>
          <button className={`rail-item ${activeCategory === "accessory" ? "active" : ""}`} onClick={() => setActiveCategory("accessory")}><Lightbulb size={18} /> Lighting</button>
          <button className={`rail-item ${activeCategory === "panel" ? "active" : ""}`} onClick={() => setActiveCategory("panel")}><Cog size={18} /> Performance</button>
          <button className={`rail-item ${activeCategory === "decal" ? "active" : ""}`} onClick={() => setActiveCategory("decal")}><Box size={18} /> Accessories</button>
          <button className={`rail-item ${activeCategory === "interior" ? "active" : ""}`} onClick={() => setActiveCategory("interior")}><Armchair size={18} /> Interior</button>

          <div className="garage-card"><div><Save size={15} /><span>Garage</span></div><small>{garageMessage}</small><button onClick={() => void saveToGarage()}>Save build</button></div>
          <div className="quick-tools"><button onClick={() => void surpriseMe()}><Shuffle size={14} /> Surprise me</button><button onClick={downloadSummary}><Download size={14} /> Download specs</button><button onClick={() => window.print()}><Printer size={14} /> Print build</button></div>

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

          <button
            className="mobile-config-trigger"
            aria-controls="configuration-panel"
            aria-expanded={mobilePanelOpen}
            onClick={() => {
              setTourOpen(false);
              setMobilePanelOpen(true);
            }}
          >
            <SlidersHorizontal size={16} /> Customize
          </button>

          <Suspense fallback={<div className="vehicle-canvas vehicle-canvas-loading"><Loader2 size={28} className="spin" /></div>}>
            <VehicleCanvas
              threeDConfig={vehicle.threeDConfig}
              catalog={bootstrap.catalog}
              cameraPreset={preset}
              lift={lift}
              terrain={terrain}
              environmentPreset={environmentPreset}
              onReady={handleSceneReady}
              onError={handleSceneError}
            />
          </Suspense>

          <div className="gpu-status">
            <span><i /> WebGPU preferred</span>
            <small>Assembled 4Runner asset · WebGL fallback ready</small>
          </div>
        </section>

        {mobilePanelOpen ? (
          <button
            className="mobile-panel-backdrop"
            aria-label="Close configuration panel"
            onClick={() => setMobilePanelOpen(false)}
          />
        ) : null}

        <aside
          id="configuration-panel"
          className={`right-panel ${mobilePanelOpen ? "mobile-open" : ""}`}
          aria-label="Vehicle configuration"
        >
          <div className="panel-title">
            <div><span>Configuration</span><h2>{CATEGORY_LABELS[activeCategory]}</h2></div>
            <div className="panel-actions">
              <Mountain size={22} />
              <button className="panel-close" aria-label="Close configuration panel" onClick={() => setMobilePanelOpen(false)}><X size={18} /></button>
            </div>
          </div>
          <div className="option-tools"><label><Search size={14} /><input ref={searchRef} value={optionQuery} onChange={(event) => setOptionQuery(event.target.value)} placeholder="Search options…" /></label><button className={selectedOnly ? "active" : ""} aria-pressed={selectedOnly} onClick={() => setSelectedOnly((value) => !value)}>Selected only</button></div>

          {catalog.length === 0 ? (
            <p className="panel-empty">Preparing customization options&hellip;</p>
          ) : null}

          {visibleGrouped.filter(({ category }) => category === activeCategory).map(({ category, options }) => (
            <section className="control-section" key={category}>
              <label>{CATEGORY_LABELS[category]}</label>
              <div className={SWATCH_CATEGORIES.has(category) ? "paint-row" : "chip-row"}>
                {options.map((option) => (
                  <CustomizationButton
                    key={option.id}
                    option={option}
                    variant={SWATCH_CATEGORIES.has(category) ? "swatch" : "chip"}
                    onBeforeSelect={rememberHistory}
                  />
                ))}
              </div>
              {options.length === 0 ? <p className="panel-empty">No matching options in this system.</p> : null}
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
            <label><CloudSun size={14} /> Environment</label>
            <div className="segmented environment-presets">
              {(["Daytime", "Sunset", "Night"] as EnvironmentPreset[]).map((item) => (
                <button
                  key={item}
                  className={environmentPreset === item ? "active" : ""}
                  aria-pressed={environmentPreset === item}
                  onClick={() => setEnvironmentPreset(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </section>
          <section className="comparison-card"><div><ClipboardCheck size={16} /><strong>Build comparison</strong></div><p><span>Base MSRP</span><b>${baseMsrp.toLocaleString()}</b></p><p><span>Configured upgrades</span><b>+${(estimatedTotal - baseMsrp).toLocaleString()}</b></p><p className="total"><span>Estimated total</span><b data-testid="estimated-total">${estimatedTotal.toLocaleString()}</b></p></section>
          <section className={`budget-card ${overBudget ? "over" : ""}`}><label htmlFor="build-budget">Target budget</label><div><span>$</span><input id="build-budget" type="number" min={baseMsrp} step="500" value={budget} onChange={(event) => setBudget(Number(event.target.value))} /></div><p>{overBudget ? `$${(estimatedTotal - budget).toLocaleString()} over target` : `$${(budget - estimatedTotal).toLocaleString()} remaining`}</p></section>
          <section className="financing-card">
            <div><Landmark size={16} /><strong>Estimated financing</strong></div>
            <div className="financing-inputs">
              <label htmlFor="financing-down">
                Down payment
                <div><span>$</span><input id="financing-down" type="number" min={0} max={estimatedTotal} step="500" value={effectiveDownPayment} onChange={(event) => setDownPayment(Math.min(estimatedTotal, Math.max(0, Number(event.target.value))))} /></div>
              </label>
              <label htmlFor="financing-apr">
                APR
                <div><input id="financing-apr" type="number" min={0} max={30} step="0.1" value={apr} onChange={(event) => setApr(Math.max(0, Number(event.target.value)))} /><span>%</span></div>
              </label>
              <label htmlFor="financing-term">
                Term
                <select id="financing-term" value={termMonths} onChange={(event) => setTermMonths(Number(event.target.value))}>
                  {[36, 48, 60, 72].map((months) => <option key={months} value={months}>{months} mo</option>)}
                </select>
              </label>
            </div>
            <p><span>Amount financed</span><b data-testid="amount-financed">${financedPrincipal.toLocaleString()}</b></p>
            <p className="total"><span>Est. monthly payment</span><b data-testid="estimated-monthly-payment">${estimatedMonthlyPayment.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo</b></p>
            <p className="financing-disclaimer">Estimate only — not a real financing offer. Actual rate and terms depend on credit and lender. Payment tracks the live build total derived from your selections.</p>
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
  // Deep-link `?c=…` wins over hash/localStorage: it carries selections + camera inline so Pages
  // and local static exports can restore a build without a durable configuration id.
  const deepLink = tryRestoreFromDeepLink(vehicle);
  if (deepLink) {
    const created = await configurationsApi.createConfiguration({
      vehicleId: vehicle.slug,
      modelYear: vehicle.year,
      gradeId: deepLink.gradeId,
      selections: deepLink.selections,
      cameraState: deepLink.cameraState,
    });
    rememberConfigurationId(vehicle.slug, created.configurationId);
    return created;
  }

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

/**
 * Decodes and catalog-validates `?c=…`. Returns null on absence or any validation failure so the
 * builder can fall through to the normal resume/create path rather than blocking on a bad link.
 */
function tryRestoreFromDeepLink(vehicle: Vehicle): ReturnType<typeof validateBuildDeepLink> | null {
  try {
    const encoded = readBuildDeepLinkParam(window.location.search);
    if (!encoded) return null;
    return validateBuildDeepLink(vehicle.slug, vehicle.year, encoded);
  } catch {
    return null;
  }
}

function safeReadStoredId(vehicleSlug: string): string | null {
  try {
    return readSharedConfigurationId(window.location.hash) ?? window.localStorage.getItem(storageKeyFor(vehicleSlug));
  } catch {
    return null;
  }
}
