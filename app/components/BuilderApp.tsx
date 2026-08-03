"use client";

import { useMemo, useState } from "react";
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
  Sun,
  Truck,
  ZoomIn
} from "lucide-react";
import { VehicleCanvas, type BuildState, type CameraPreset } from "./VehicleCanvas";

const PAINTS = [
  { name: "Blueprint", value: "#1558d6" },
  { name: "Midnight Black", value: "#101215" },
  { name: "Ice Cap", value: "#d8dde2" },
  { name: "Underground", value: "#4f545a" },
  { name: "Barcelona Red", value: "#9d1d20" }
];

const CAMERA_PRESETS: CameraPreset[] = [
  { id: "hero", label: "Hero", position: [7.5, 4.0, 8.5], target: [0, 1.1, 0] },
  { id: "front", label: "Front", position: [0, 2.2, 10], target: [0, 1.0, 0] },
  { id: "side", label: "Side", position: [10, 2.2, 0], target: [0, 1.0, 0] },
  { id: "rear", label: "Rear", position: [0, 2.2, -10], target: [0, 1.0, 0] }
];

export function BuilderApp() {
  const [build, setBuild] = useState<BuildState>({
    paint: PAINTS[0].value,
    lift: 2,
    roofRack: true,
    lightBar: true,
    sliders: true,
    wheels: "Trail"
  });
  const [preset, setPreset] = useState<CameraPreset>(CAMERA_PRESETS[0]);
  const [saved, setSaved] = useState(false);

  const installed = useMemo(
    () => [
      build.roofRack && "Roof rack",
      build.lightBar && "LED light bar",
      build.sliders && "Rock sliders",
      build.lift > 0 && `${build.lift}" lift`,
      `${build.wheels} wheels`
    ].filter(Boolean) as string[],
    [build]
  );

  const reset = () => {
    setBuild({
      paint: PAINTS[0].value,
      lift: 2,
      roofRack: true,
      lightBar: true,
      sliders: true,
      wheels: "Trail"
    });
    setPreset(CAMERA_PRESETS[0]);
    setSaved(false);
  };

  return (
    <main className="builder-shell">
      <header className="topbar">
        <div className="brand">
          <Truck size={24} />
          <div>
            <strong>4RUNNER</strong>
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
            <span>2024 TOYOTA</span>
            <h1>4Runner Limited</h1>
            <p>Private build #7416-inspired setup</p>
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
              {CAMERA_PRESETS.map((item) => (
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

          <VehicleCanvas build={build} cameraPreset={preset} />

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
              {PAINTS.map((paint) => (
                <button
                  key={paint.value}
                  aria-label={paint.name}
                  title={paint.name}
                  className={build.paint === paint.value ? "active" : ""}
                  style={{ background: paint.value }}
                  onClick={() => setBuild({ ...build, paint: paint.value })}
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

          <section className="control-section">
            <label>Wheel style</label>
            <div className="segmented">
              {["Stock", "Trail", "Beadlock"].map((wheels) => (
                <button
                  key={wheels}
                  className={build.wheels === wheels ? "active" : ""}
                  onClick={() => setBuild({ ...build, wheels })}
                >
                  {wheels}
                </button>
              ))}
            </div>
          </section>

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
