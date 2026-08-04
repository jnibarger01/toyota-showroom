"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Camera, Check, ChevronDown, CircleGauge, ClipboardCheck, CloudSun,
  Cog, Expand, Gauge, Lightbulb, Map, PaintBucket, RotateCcw,
  Save, Share2, SlidersHorizontal, Truck
} from "lucide-react";
import { VehicleCanvas, type BuildState, type CameraPreset, type SceneMood, type Terrain } from "./VehicleCanvas";

const STORAGE_KEY = "toyota-showroom-build-v1";
const BASE_PRICE = 48_720;
const PAINTS = [
  { name: "Blueprint", value: "#1558d6", price: 0 },
  { name: "Midnight Black", value: "#101215", price: 425 },
  { name: "Ice Cap", value: "#d8dde2", price: 425 },
  { name: "Underground", value: "#4f545a", price: 425 },
  { name: "Barcelona Red", value: "#9d1d20", price: 425 }
];
const DEFAULT_BUILD: BuildState = { paint: PAINTS[0].value, lift: 2, roofRack: true, lightBar: true, sliders: true, wheels: "Trail" };
const CAMERA_PRESETS: CameraPreset[] = [
  { id: "hero", label: "Hero", position: [7.8, 3.4, -9.6], target: [0, 1.0, -0.25] },
  { id: "front", label: "Front", position: [0, 2.2, -10], target: [0, 1.0, 0] },
  { id: "side", label: "Side", position: [10, 2.2, 0], target: [0, 1.0, 0] },
  { id: "rear", label: "Rear", position: [0, 2.2, 10], target: [0, 1.0, 0] },
  { id: "detail", label: "Detail", position: [4.2, 1.8, -4.8], target: [0, 1.0, -1.4] }
];
const SECTIONS = [
  ["Exterior", PaintBucket], ["Wheels & Tires", CircleGauge], ["Suspension", SlidersHorizontal],
  ["Lighting", Lightbulb], ["Performance", Cog], ["Accessories", Box]
] as const;

type Section = (typeof SECTIONS)[number][0];
type GarageBuild = { build: BuildState; terrain: Terrain; sceneMood: SceneMood; savedAt: string };

export function BuilderApp() {
  const [build, setBuild] = useState<BuildState>(DEFAULT_BUILD);
  const [preset, setPreset] = useState<CameraPreset>(CAMERA_PRESETS[0]);
  const [section, setSection] = useState<Section>("Exterior");
  const [terrain, setTerrain] = useState<Terrain>("Studio");
  const [sceneMood, setSceneMood] = useState<SceneMood>("Day");
  const [notice, setNotice] = useState("Ready to configure");
  const [garageBuild, setGarageBuild] = useState<GarageBuild | null>(null);
  const stageRef = useRef<HTMLElement>(null);

  const selectedPaint = PAINTS.find((paint) => paint.value === build.paint) ?? PAINTS[0];
  const installed = useMemo(() => [
    build.roofRack && "Roof rack", build.lightBar && "LED light bar", build.sliders && "Rock sliders",
    build.lift > 0 && `${build.lift}\" lift`, `${build.wheels} wheels`
  ].filter(Boolean) as string[], [build]);
  const price = BASE_PRICE + selectedPaint.price + build.lift * 860 + (build.wheels === "Trail" ? 1_640 : build.wheels === "Beadlock" ? 2_980 : 0)
    + (build.roofRack ? 1_190 : 0) + (build.lightBar ? 690 : 0) + (build.sliders ? 920 : 0);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try { setGarageBuild(JSON.parse(raw) as GarageBuild); } catch { window.localStorage.removeItem(STORAGE_KEY); }
  }, []);

  useEffect(() => {
    const encoded = new URLSearchParams(window.location.hash.slice(1)).get("build");
    if (!encoded) return;
    try {
      const shared = JSON.parse(atob(encoded)) as { b: BuildState; t: Terrain; m: SceneMood };
      if (shared.b && shared.t && shared.m) {
        setBuild(shared.b); setTerrain(shared.t); setSceneMood(shared.m); setNotice("Shared build loaded");
      }
    } catch { setNotice("This share link could not be read"); }
  }, []);

  const updateBuild = (change: Partial<BuildState>) => setBuild((current) => ({ ...current, ...change }));
  const reset = () => { setBuild(DEFAULT_BUILD); setPreset(CAMERA_PRESETS[0]); setTerrain("Studio"); setSceneMood("Day"); setNotice("Factory configuration restored"); };
  const saveBuild = () => {
    const next = { build, terrain, sceneMood, savedAt: new Date().toISOString() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setGarageBuild(next); setNotice("Build saved to this browser");
  };
  const loadBuild = () => {
    if (!garageBuild) return;
    setBuild(garageBuild.build); setTerrain(garageBuild.terrain); setSceneMood(garageBuild.sceneMood); setNotice("Saved build loaded");
  };
  const shareBuild = async () => {
    const state = btoa(JSON.stringify({ b: build, t: terrain, m: sceneMood }));
    const url = `${window.location.origin}${window.location.pathname}#build=${state}`;
    try { await navigator.clipboard.writeText(url); setNotice("Share link copied to clipboard"); }
    catch { window.prompt("Copy this build link", url); setNotice("Share link ready to copy"); }
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen();
    } catch { setNotice("Fullscreen is unavailable in this browser"); }
  };

  return (
    <main className="builder-shell">
      <header className="topbar">
        <div className="brand"><Truck size={24} /><div><strong>4RUNNER</strong><span>WEBGPU BUILDER</span></div></div>
        <nav aria-label="Showroom"><button className="active">Build</button><button onClick={() => setNotice("Explorer tours are coming soon")}>Explore</button><button onClick={loadBuild}>Garage</button></nav>
        <div className="top-actions"><button className="ghost" onClick={reset}><RotateCcw size={16} /> Reset</button><button className="ghost" onClick={saveBuild}><Save size={16} /> Save</button><button className="primary" onClick={shareBuild}><Share2 size={16} /> Share</button></div>
      </header>
      <section className="workspace">
        <aside className="left-rail">
          <div className="vehicle-title"><span>2024 TOYOTA</span><h1>4Runner Limited</h1><p>Build #7416-inspired setup</p></div>
          <div className="summary"><div><span>Estimated build</span><strong>${price.toLocaleString()}</strong></div><div><span>Installed</span><strong>{installed.length}</strong></div><div><span>Terrain</span><strong>{terrain}</strong></div></div>
          <div className="section-label">Systems</div>
          {SECTIONS.map(([name, Icon]) => <button key={name} className={`rail-item ${section === name ? "active" : ""}`} onClick={() => setSection(name)}><Icon size={18}/>{name}</button>)}
          <div className="garage-card"><div><Save size={15}/><span>Local garage</span></div><small>{garageBuild ? `Saved ${new Date(garageBuild.savedAt).toLocaleDateString()}` : "No build saved yet"}</small>{garageBuild && <button onClick={loadBuild}>Load saved build</button>}</div>
        </aside>
        <section className="stage" ref={stageRef}>
          <div className="stage-toolbar"><div className="camera-group"><Camera size={16} />{CAMERA_PRESETS.map((item) => <button key={item.id} className={preset.id === item.id ? "selected" : ""} onClick={() => setPreset(item)}>{item.label}</button>)}</div><div className="viewport-actions"><button title="Switch to detail camera" onClick={() => setPreset(CAMERA_PRESETS[4])}><Gauge size={17}/></button><button title="Fullscreen" onClick={toggleFullscreen}><Expand size={17}/></button></div></div>
          <VehicleCanvas build={build} cameraPreset={preset} terrain={terrain} sceneMood={sceneMood} />
          <div className="gpu-status" aria-live="polite"><span><i /> {notice}</span><small>WebGPU preferred · WebGL fallback ready</small></div>
          <div className="installed-strip"><div className="strip-title"><strong>Installed parts</strong><span>{installed.length} active · ${price.toLocaleString()}</span></div><div className="chips">{installed.map((item) => <span key={item}><Check size={13}/>{item}</span>)}</div></div>
        </section>
        <aside className="right-panel">
          <div className="panel-title"><div><span>Configuration</span><h2>{section}</h2></div><ChevronDown size={20}/></div>
          {section === "Exterior" && <section className="control-section"><label>Paint <small>+${selectedPaint.price}</small></label><div className="paint-row">{PAINTS.map((paint) => <button key={paint.value} aria-label={paint.name} title={`${paint.name} +$${paint.price}`} className={build.paint === paint.value ? "active" : ""} style={{ background: paint.value }} onClick={() => updateBuild({ paint: paint.value })} />)}</div><p className="control-help">{selectedPaint.name} exterior finish</p></section>}
          {(section === "Suspension" || section === "Performance") && <section className="control-section"><label>Lift height <small>+$860/in</small></label><div className="segmented">{[0, 1, 2, 3].map((lift) => <button key={lift} className={build.lift === lift ? "active" : ""} onClick={() => updateBuild({ lift })}>{lift}\"</button>)}</div><p className="control-help">Estimated clearance: {(8.3 + build.lift).toFixed(1)} in</p></section>}
          {(section === "Wheels & Tires" || section === "Performance") && <section className="control-section"><label>Wheel style</label><div className="segmented">{["Stock", "Trail", "Beadlock"].map((wheels) => <button key={wheels} className={build.wheels === wheels ? "active" : ""} onClick={() => updateBuild({ wheels })}>{wheels}</button>)}</div></section>}
          {(section === "Accessories" || section === "Lighting") && <><Toggle label="Roof rack" description="Low-profile overland rack · +$1,190" checked={build.roofRack} onChange={(roofRack) => updateBuild({ roofRack })}/><Toggle label="LED light bar" description="Amber forward lighting · +$690" checked={build.lightBar} onChange={(lightBar) => updateBuild({ lightBar })}/><Toggle label="Rock sliders" description="Frame-mounted protection · +$920" checked={build.sliders} onChange={(sliders) => updateBuild({ sliders })}/></>}
          <section className="control-section scene-controls"><label><Map size={14}/> Terrain preview</label><div className="segmented">{(["Studio", "Trail", "Night"] as Terrain[]).map((item) => <button key={item} className={terrain === item ? "active" : ""} onClick={() => setTerrain(item)}>{item}</button>)}</div><label><CloudSun size={14}/> Lighting</label><div className="segmented">{(["Day", "Golden hour", "Night"] as SceneMood[]).map((item) => <button key={item} className={sceneMood === item ? "active" : ""} onClick={() => setSceneMood(item)}>{item}</button>)}</div></section>
          <section className="comparison-card"><div><ClipboardCheck size={16}/><strong>Build comparison</strong></div><p><span>Base MSRP</span><b>${BASE_PRICE.toLocaleString()}</b></p><p><span>Configured upgrades</span><b>+${(price - BASE_PRICE).toLocaleString()}</b></p><p className="total"><span>Estimated total</span><b>${price.toLocaleString()}</b></p></section>
          <button className="save-build" onClick={saveBuild}><Save size={16}/> Save build to garage</button>
        </aside>
      </section>
    </main>
  );
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void; }) {
  return <button className="toggle-row" onClick={() => onChange(!checked)}><span><strong>{label}</strong><small>{description}</small></span><i className={checked ? "on" : ""}><b /></i></button>;
}
