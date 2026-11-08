"use client";

import { CustomizationButton } from "./CustomizationButton";
import type { CameraPreset } from "./VehicleCanvas";
import { LAMP_MODES, type LampMode } from "../../lib/three/vehicleLights";
import type { CustomizationCategory, CustomizationOption } from "../../lib/types/customization";
import type { Vehicle } from "../../lib/types/vehicle";
import styles from "./ShowroomV2Panel.module.css";

type Props = {
  vehicle: Vehicle;
  cameraPresets: readonly CameraPreset[];
  activePresetId: string;
  onCameraChange: (preset: CameraPreset) => void;
  paintOptions: readonly CustomizationOption[];
  finishOptions: readonly CustomizationOption[];
  wheelOptions: readonly CustomizationOption[];
  paintMode: "oem" | "custom";
  onBeforePaintChange: () => void;
  onBeforeWheelChange: () => void;
  onEditCategory: (category: CustomizationCategory) => void;
  selectedGradeName?: string;
  lift: number;
  onLiftChange: (inches: number) => void;
  showHotspots: boolean;
  hotspotsAvailable: boolean;
  onToggleHotspots: () => void;
  showDimensions: boolean;
  onToggleDimensions: () => void;
  doorsAvailable: boolean;
  doorsOpen: boolean;
  onToggleDoors: () => void;
  driverViewAvailable: boolean;
  driverView: boolean;
  onToggleDriverView: () => void;
  lampModes: readonly LampMode[];
  lampMode: LampMode;
  onLampModeChange: (mode: LampMode) => void;
  onExit: () => void;
};

/**
 * Full-bleed vehicle-first presentation, using the same catalog and scene as Build & Price.
 * Nothing here creates geometry or writes a new persistence format. Authored assets and
 * the existing CustomizationButton/VehicleCanvas are the only visual source of truth.
 */
export function ShowroomV2Panel({
  vehicle, cameraPresets, activePresetId, onCameraChange, paintOptions, finishOptions,
  wheelOptions, paintMode, onBeforePaintChange, onBeforeWheelChange, onEditCategory,
  selectedGradeName, lift, onLiftChange, showHotspots, hotspotsAvailable,
  onToggleHotspots, showDimensions, onToggleDimensions, doorsAvailable, doorsOpen,
  onToggleDoors, driverViewAvailable, driverView, onToggleDriverView,
  lampModes, lampMode, onLampModeChange, onExit,
}: Props) {
  const specs = vehicle.specs
    .filter((spec) => (spec.category === "performance" || spec.category === "dimensions") && spec.value !== "")
    .slice(0, 4);

  return (
    <div className={styles.overlay} data-testid="showroom-v2-overlay">
      <header className={styles.hero}>
        <span className={styles.kicker}>Toyota / Interactive showroom v2</span>
        <h2>{vehicle.model}</h2>
        <p>{vehicle.year} Toyota{selectedGradeName ? " · " + selectedGradeName : ""}</p>
        <span className={styles.assetNote}>
          {vehicle.threeDConfig.hasModel
            ? "Catalog 3D asset · actual geometry, not an invented vehicle"
            : "No authored 3D model published for this vehicle"}
        </span>
      </header>

      <aside className={styles.panel} aria-label="Showroom v2 controls">
        <div className={styles.panelHeader}>
          <div><span className={styles.kicker}>Configuration studio</span><h2>Explore the details</h2></div>
          <button type="button" className={styles.exit} onClick={onExit}>Back to builder</button>
        </div>

        <section className={styles.section}>
          <h3>Factory paint</h3>
          {paintMode === "custom" ? (
            <p className={styles.note}>A custom paint is active. Return to the paint studio to edit it or choose an OEM finish.</p>
          ) : paintOptions.length > 0 ? (
            <div className={styles.swatches} data-testid="v2-paint-swatches">
              {paintOptions.map((option) => (
                <div key={option.id} className={styles.paintChoice}>
                  <CustomizationButton option={option} variant="swatch" onBeforeSelect={onBeforePaintChange} />
                  <span aria-hidden="true">{option.label}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.note}>No factory colors available for this configuration.</p>
          )}
          <button type="button" className={styles.textAction} onClick={() => onEditCategory("paint")}>Full paint studio</button>
        </section>

        {finishOptions.length > 0 && paintMode === "oem" ? (
          <section className={styles.section}>
            <h3>Paint finish</h3>
            <div className={styles.chips}>
              {finishOptions.map((option) => (
                <CustomizationButton key={option.id} option={option} onBeforeSelect={onBeforePaintChange} />
              ))}
            </div>
          </section>
        ) : null}

        <section className={styles.section}>
          <h3>Wheels and tires</h3>
          {wheelOptions.length ? (
            <div className={styles.chips} data-testid="v2-wheel-options">
              {wheelOptions.map((option) => (
                <CustomizationButton key={option.id} option={option} onBeforeSelect={onBeforeWheelChange} />
              ))}
            </div>
          ) : (
            <p className={styles.note}>No wheel options available for this model.</p>
          )}
          <p className={styles.note}>Packages marked Preview use generated fitment geometry, not an OEM wheel mesh.</p>
          <button type="button" className={styles.textAction} onClick={() => onEditCategory("wheels")}>More wheel options</button>
        </section>

        <section className={styles.section}>
          <h3>Camera views</h3>
          <div className={styles.views} role="group" aria-label="Camera views">
            {cameraPresets.map((preset) => (
              <button
                type="button"
                key={preset.id}
                aria-pressed={activePresetId === preset.id}
                className={activePresetId === preset.id ? styles.selected : ""}
                onClick={() => onCameraChange(preset)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h3>Ride height</h3>
          <div className={styles.chips} role="group" aria-label="Lift height in inches">
            {[0, 1, 2, 3].map((height) => (
              <button
                type="button"
                key={height}
                className={styles.choice}
                aria-pressed={height === lift}
                onClick={() => onLiftChange(height)}
              >
                {height === 0 ? "Stock" : height + " in"}
              </button>
            ))}
          </div>
          <p className={styles.note}>Temporary visual stance preview; not an engineering ride-height specification.</p>
        </section>

        <section className={styles.section}>
          <h3>Technical inspection</h3>
          <div className={styles.toggles}>
            {hotspotsAvailable ? (
              <button type="button" aria-pressed={showHotspots} onClick={onToggleHotspots}>Feature hotspots <span>{showHotspots ? "On" : "Off"}</span></button>
            ) : (
              <p className={styles.note}>Feature hotspots unavailable for this model.</p>
            )}
            <button type="button" aria-pressed={showDimensions} onClick={onToggleDimensions}>Dimensions <span>{showDimensions ? "On" : "Off"}</span></button>
            {doorsAvailable ? (
              <button type="button" aria-pressed={doorsOpen} onClick={onToggleDoors}>Open doors <span>{doorsOpen ? "On" : "Off"}</span></button>
            ) : null}
            {driverViewAvailable ? (
              <button type="button" aria-pressed={driverView} onClick={onToggleDriverView}>Driver's view <span>{driverView ? "On" : "Off"}</span></button>
            ) : null}
          </div>
          <p className={styles.note}>X-ray and exploded views require independently modeled parts; unavailable controls are intentionally omitted.</p>
        </section>

        {lampModes.length > 0 ? (
          <section className={styles.section}>
            <h3>Lighting</h3>
            <div className={styles.chips} role="group" aria-label="Vehicle light mode">
              {LAMP_MODES.filter((mode) => lampModes.includes(mode.id)).map((mode) => (
                <button
                  type="button"
                  key={mode.id}
                  className={styles.choice}
                  aria-pressed={lampMode === mode.id}
                  onClick={() => onLampModeChange(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <footer className={styles.disclaimer}>
          Visual preview only. Vehicle models and option availability follow the published asset and catalog; specifications are from the vehicle data.
        </footer>
      </aside>

      {specs.length > 0 ? (
        <div className={styles.specStrip} aria-label="Vehicle specifications">
          {specs.map((spec) => (
            <div className={styles.specCell} key={spec.key}>
              <strong>{String(spec.value)}{spec.unit ? " " + spec.unit : ""}</strong>
              <span>{spec.label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
