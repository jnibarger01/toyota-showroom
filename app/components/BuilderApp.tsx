"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Camera,
  Check,
  CircleGauge,
  Cog,
  Expand,
  Lightbulb,
  Mountain,
  PaintBucket,
  RotateCcw,
  Save,
  Settings2,
  Share2,
  SlidersHorizontal,
  Truck,
  ZoomIn
} from "lucide-react";
import { VehicleCanvas, type BuildState, type CameraPreset } from "./VehicleCanvas";
import { getVehicle } from "../../lib/api/client";
import type { Vehicle } from "../../lib/types/vehicle";

const VEHICLE_SLUG = "4runner";

function defaultBuild(vehicle: Vehicle): BuildState {
  const wheelVariants = vehicle.threeDConfig.wheelVariants;
  return {
    paint: vehicle.exteriorColors[0]?.hex ?? "#1558d6",
    lift: 2,
    roofRack: true,
    lightBar: true,
    sliders: true,
    wheels: wheelVariants.find((v) => v.id === "trail")?.id ?? wheelVariants[0]?.id ?? "stock",
  };
}

function startingMsrp(vehicle: Vehicle): number {
  return Math.min(vehicle.pricing.baseMsrp, ...vehicle.grades.map((g) => g.msrp));
}

export function BuilderApp() {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [build, setBuild] = useState<BuildState | null>(null);
  const [preset, setPreset] = useState<CameraPreset | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getVehicle(VEHICLE_SLUG)
      .then((data) => {
        if (cancelled) return;
        setVehicle(data);
        setBuild(defaultBuild(data));
        setPreset(data.threeDConfig.cameraPresets[0] ?? null);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const installed = useMemo(() => {
    if (!build) return [] as string[];
    return [
      build.roofRack && "Roof rack",
      build.lightBar && "LED light bar",
      build.sliders && "Rock sliders",
      build.lift > 0 && `${build.lift}" lift`
    ].filter(Boolean) as string[];
  }, [build]);

  const reset = () => {
    if (!vehicle) return;
    setBuild(defaultBuild(vehicle));
    setPreset(vehicle.threeDConfig.cameraPresets[0] ?? null);
    setSaved(false);
  };

  if (loadError) {
    return (
      <main className="builder-shell builder-status">
        <p>Couldn&rsquo;t load vehicle data: {loadError}</p>
      </main>
    );
  }

  if (!vehicle || !build || !preset) {
    return (
      <main className="builder-shell builder-status">
        <p>Loading {VEHICLE_SLUG}&hellip;</p>
      </main>
    );
  }

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
          <button className="ghost" onClick={reset}><RotateCcw size={16} /> Reset</button>
          <button className="ghost" onClick={() => setSaved(true)}>
            {saved ? <Check size={16} /> : <Save size={16} />}
            {saved ? "Saved locally" : "Save"}
          </button>
          <button className="primary"><Share2 size={16} /> Share</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="left-rail">
          <div className="vehicle-title">
            <span>{vehicle.year} TOYOTA</span>
            <h1>{vehicle.model}</h1>
            <p>Starting at ${startingMsrp(vehicle).toLocaleString()}</p>
          </div>

          <div className="summary">
            <div><span>Installed</span><strong>{installed.length}</strong></div>
            <div><span>Lift</span><strong>{build.lift}"</strong></div>
            <div><span>Renderer</span><strong>WebGPU</strong></div>
          </div>

          <div className="section-label">Systems</div>
          <button className="rail-item active"><PaintBucket size={18}/> Exterior</button>
          <button className="rail-item"><CircleGauge size={18}/> Wheels & Tires</button>
          <button className="rail-item"><SlidersHorizontal size={18}/> Suspension</button>
          <button className="rail-item"><Lightbulb size={18}/> Lighting</button>
          <button className="rail-item"><Cog size={18}/> Performance</button>
          <button className="rail-item"><Box size={18}/> Accessories</button>

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
                  onClick={() => setPreset(item)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="viewport-actions">
              <button title="Zoom"><ZoomIn size={17}/></button>
              <button title="Settings"><Settings2 size={17}/></button>
              <button title="Fullscreen"><Expand size={17}/></button>
            </div>
          </div>

          <VehicleCanvas build={build} cameraPreset={preset} threeDConfig={vehicle.threeDConfig} />

          <div className="gpu-status">
            <span><i /> WebGPU active</span>
            <small>Procedural geometry · no GLB required</small>
          </div>

          <div className="installed-strip">
            <div className="strip-title">
              <strong>Installed parts</strong>
              <span>{installed.length} active</span>
            </div>
            <div className="chips">
              {installed.map((item) => <span key={item}><Check size={13}/>{item}</span>)}
            </div>
          </div>
        </section>

        <aside className="right-panel">
          <div className="panel-title">
            <div><span>Configuration</span><h2>Exterior</h2></div>
            <Mountain size={22}/>
          </div>

          <section className="control-section">
            <label>Paint</label>
            <div className="paint-row">
              {vehicle.exteriorColors.map((color) => (
                <button
                  key={color.code}
                  aria-label={color.name}
                  title={color.name}
                  className={build.paint === color.hex ? "active" : ""}
                  style={{ background: color.hex }}
                  onClick={() => setBuild({ ...build, paint: color.hex })}
                />
              ))}
            </div>
          </section>

          <section className="control-section">
            <label>Lift height</label>
            <div className="segmented">
              {[0, 1, 2, 3].map((lift) => (
                <button
                  key={lift}
                  className={build.lift === lift ? "active" : ""}
                  onClick={() => setBuild({ ...build, lift })}
                >
                  {lift}"
                </button>
              ))}
            </div>
          </section>

          <Toggle
            label="Roof rack"
            description="Low-profile overland rack"
            checked={build.roofRack}
            onChange={(roofRack) => setBuild({ ...build, roofRack })}
          />
          <Toggle
            label="LED light bar"
            description="Amber forward lighting"
            checked={build.lightBar}
            onChange={(lightBar) => setBuild({ ...build, lightBar })}
          />
          <Toggle
            label="Rock sliders"
            description="Frame-mounted side protection"
            checked={build.sliders}
            onChange={(sliders) => setBuild({ ...build, sliders })}
          />

          {/*
            Wheel style is intentionally not exposed yet: `refs.wheels` is empty in every
            current render path (real GLB and procedural fallback alike — see
            VehicleCanvas.tsx), so selecting a variant here would change no visible geometry.
            Goal 22 (Phase 3) wires this up against real wheel meshes; re-add the control then.
          */}

          <button className="save-build" onClick={() => setSaved(true)}>
            <Save size={16}/> Save build to D1
          </button>
        </aside>
      </section>
    </main>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button className="toggle-row" onClick={() => onChange(!checked)}>
      <span><strong>{label}</strong><small>{description}</small></span>
      <i className={checked ? "on" : ""}><b /></i>
    </button>
  );
}
