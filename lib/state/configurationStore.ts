import {
  isMultiSelect,
  isSelected,
  withOptionDeselected,
  withOptionSelected,
  type CustomizationOption,
  type SelectionMap,
  type VehicleConfiguration,
} from "../types/customization";
import type { VehicleSceneController } from "../three/sceneController";
import * as configurationsApi from "../api/configurations";

/**
 * Centralized customization state.
 *
 * Deliberately a small external store driven by `useSyncExternalStore` rather than a new
 * dependency: the app already ships React 19 and this is the whole surface it needs. Swapping in
 * Zustand later is a like-for-like replacement — `create()` over the same `selectOption`,
 * `deselectOption`, and `restore` actions — because no component reaches past these actions.
 *
 * The store is the single place that sequences the four steps the integration must keep in order:
 * mutate state → mutate the scene → persist → roll back both on failure.
 */

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface ConfigurationState {
  configuration: VehicleConfiguration | null;
  /** Options confirmed applicable against the loaded GLB (see `verifyNodeContract`). */
  catalog: CustomizationOption[];
  status: SaveStatus;
  error: string | null;
  /** Option ids with an in-flight or queued write, for per-control pending affordances. */
  pending: Set<string>;
}

const PERSIST_DEBOUNCE_MS = 400;

function emptyState(): ConfigurationState {
  return { configuration: null, catalog: [], status: "idle", error: null, pending: new Set() };
}

export class ConfigurationStore {
  private state: ConfigurationState = emptyState();
  private listeners = new Set<() => void>();
  private controller: VehicleSceneController | null = null;

  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Snapshot taken when a batch opens — the last state known to match the server. Rollback
   * restores this, not the immediately-previous state, so a failed write undoes the whole batch
   * rather than leaving a half-applied build on screen.
   */
  private lastPersisted: VehicleConfiguration | null = null;
  private batchedOptionIds = new Set<string>();

  // ------------------------------------------------------------ subscription
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ConfigurationState => this.state;

  private setState(patch: Partial<ConfigurationState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  // ----------------------------------------------------------- initialization
  /**
   * Called once the base GLB is loaded and its node contract verified. Applying the configuration
   * here — rather than when it arrives from the API — is what removes the race between model
   * loading and configuration loading: whichever finishes last, the scene is only touched when
   * both are in hand.
   */
  async attachScene(
    controller: VehicleSceneController,
    configuration: VehicleConfiguration,
    catalog: CustomizationOption[],
  ): Promise<void> {
    this.controller = controller;
    this.lastPersisted = configuration;
    this.setState({ configuration, catalog, status: "idle", error: null });

    const { failed } = await controller.applyConfiguration(configuration.selections);
    if (failed.length > 0) {
      this.setState({
        status: "error",
        error: `Could not apply saved options: ${failed.join(", ")}`,
      });
    }
  }

  detachScene(): void {
    this.controller = null;
  }

  reset(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.batchedOptionIds.clear();
    this.lastPersisted = null;
    this.state = emptyState();
    for (const listener of this.listeners) listener();
  }

  // ----------------------------------------------------------------- actions
  /**
   * The one entry point every customization control calls.
   *
   * Order matters: local state and the scene are updated synchronously so the viewport responds on
   * the same frame as the click, and only then is the write queued. A rejected write restores both.
   */
  async selectOption(option: CustomizationOption): Promise<void> {
    const current = this.state.configuration;
    if (!current) return;

    const alreadyOn = isSelected(current.selections, option);
    const selections = alreadyOn
      ? withOptionDeselected(current.selections, option)
      : withOptionSelected(current.selections, option);

    // Re-selecting a single-select option is a no-op rather than a redundant round trip.
    if (alreadyOn && !isMultiSelect(option.category)) return;

    const next: VehicleConfiguration = {
      ...current,
      selections,
      updatedAt: new Date().toISOString(),
    };

    const pending = new Set(this.state.pending).add(option.id);
    this.setState({ configuration: next, pending, status: "saving", error: null });
    this.batchedOptionIds.add(option.id);

    await this.applyToScene(option, !alreadyOn);
    this.queueFlush();
  }

  private async applyToScene(option: CustomizationOption, enable: boolean): Promise<void> {
    const controller = this.controller;
    if (!controller) return;

    const ok = enable ? await controller.applyOption(option) : await controller.removeOption(option);
    if (!ok) {
      // The scene could not honour the selection. Treat it as a failed change and undo it, rather
      // than leaving state claiming an option that the viewport does not show.
      await this.rollback(`"${option.label}" could not be applied to the model.`);
    }
  }

  /** Applies the camera without persisting on every orbit frame; the batch flush carries it. */
  setCameraState(cameraState: VehicleConfiguration["cameraState"]): void {
    const current = this.state.configuration;
    if (!current) return;
    this.setState({ configuration: { ...current, cameraState } });
    this.queueFlush();
  }

  // -------------------------------------------------------------- persistence
  private queueFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), PERSIST_DEBOUNCE_MS);
  }

  /**
   * Sends one PATCH for the whole batch. Rapid clicking a colour row therefore produces a single
   * write carrying the final state, not one per swatch.
   */
  async flush(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;

    const configuration = this.state.configuration;
    if (!configuration) return;

    const batched = [...this.batchedOptionIds];
    this.batchedOptionIds.clear();

    try {
      const saved = await configurationsApi.updateConfiguration(configuration.configurationId, {
        selections: configuration.selections,
        cameraState: configuration.cameraState,
        expectedRevision: this.lastPersisted?.revision,
      });
      this.lastPersisted = saved;
      // Adopt the server's canonical record — it owns revision, timestamps, and any normalization.
      this.setState({
        configuration: saved,
        status: "saved",
        error: null,
        pending: withoutIds(this.state.pending, batched),
      });
    } catch (error) {
      await this.rollback(error instanceof Error ? error.message : String(error), batched);
    }
  }

  /**
   * Restores the last server-confirmed configuration in both state and scene.
   *
   * Reapplying through `applyConfiguration` rather than inverting the failed operation keeps this
   * correct for every operation type, including mesh replacement, where "undo" is not simply the
   * opposite of the last call.
   */
  private async rollback(message: string, batched: string[] = []): Promise<void> {
    const restored = this.lastPersisted;
    this.setState({
      configuration: restored ?? this.state.configuration,
      status: "error",
      error: message,
      pending: withoutIds(this.state.pending, batched.length ? batched : [...this.state.pending]),
    });
    // Awaited, not fired and forgotten: callers — and the user — must not observe the scene still
    // showing the rejected selection after the store has reported the failure.
    if (restored && this.controller) {
      await this.controller.applyConfiguration(restored.selections);
    }
  }

  clearError(): void {
    if (this.state.status === "error") this.setState({ status: "idle", error: null });
  }
}

function withoutIds(pending: Set<string>, ids: string[]): Set<string> {
  const next = new Set(pending);
  for (const id of ids) next.delete(id);
  return next;
}

export const configurationStore = new ConfigurationStore();
