import {
  isMultiSelect,
  isSelected,
  withOptionDeselected,
  withOptionSelected,
  type CustomizationOption,
  type SelectionMap,
  type VehicleConfiguration,
} from "../types/customization";
import type { PaintStudioState } from "../types/paintStudio";
import { DEFAULT_HDRI_PRESET_ID, PAINT_CUSTOM_OPTION_ID } from "../data/paintStudio";
import type { VehicleSceneController } from "../three/sceneController";
import * as configurationsApi from "../api/configurations";
import {
  isRevisionConflict,
  messageForSaveFailure,
  saveFailureReason,
  type SaveFailureReason,
} from "../api/saveFailure";
import {
  trackOptionChanged,
  trackSaveFailed,
  trackSaveSucceeded,
} from "../observability/funnelTelemetry";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface ConfigurationState {
  configuration: VehicleConfiguration | null;
  catalog: CustomizationOption[];
  status: SaveStatus;
  error: string | null;
  /**
   * Classified save failure when `status === "error"` after a persist attempt.
   * `conflict` in Worker mode unlocks reload / overwrite / fork recovery (#52).
   * Null for scene-apply failures and after dismiss.
   */
  saveFailure: SaveFailureReason | null;
  pending: Set<string>;
}

const PERSIST_DEBOUNCE_MS = 400;

function emptyState(): ConfigurationState {
  return {
    configuration: null,
    catalog: [],
    status: "idle",
    error: null,
    saveFailure: null,
    pending: new Set(),
  };
}

export class ConfigurationStore {
  private state: ConfigurationState = emptyState();
  private listeners = new Set<() => void>();
  private controller: VehicleSceneController | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;
  private flushRequested = false;
  private mutationVersion = 0;
  private lastPersisted: VehicleConfiguration | null = null;
  private batchedOptionIds = new Set<string>();
  private sceneMutationQueue: Promise<void> | null = null;
  /** Local edits retained across a Worker revision conflict until reload / overwrite / fork. */
  private conflictDraft: VehicleConfiguration | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ConfigurationState => this.state;

  private setState(patch: Partial<ConfigurationState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /**
   * Publish configuration + catalog before the detailed mesh settles so builder chrome (option
   * buttons, Share, camera persistence) is usable after bootstrap / progressive first paint.
   * Scene mutations no-op until `attachScene` wires a controller (`applyToScene` early-returns).
   */
  hydrate(configuration: VehicleConfiguration, catalog: CustomizationOption[]): void {
    this.controller = null;
    this.lastPersisted = configuration;
    this.conflictDraft = null;
    this.mutationVersion = 0;
    this.batchedOptionIds.clear();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.flushRequested = false;
    this.setState({
      configuration,
      catalog,
      status: "idle",
      error: null,
      saveFailure: null,
      pending: new Set(),
    });
  }

  async attachScene(
    controller: VehicleSceneController,
    configuration: VehicleConfiguration,
    catalog: CustomizationOption[],
  ): Promise<void> {
    this.controller = controller;

    const live = this.state.configuration;
    const sameBuild = live?.configurationId === configuration.configurationId;
    if (!sameBuild) {
      // Different record (reset / grade switch): reset persistence bookkeeping.
      this.lastPersisted = configuration;
      this.conflictDraft = null;
      this.mutationVersion = 0;
      this.batchedOptionIds.clear();
      this.setState({
        configuration,
        catalog,
        status: "idle",
        error: null,
        saveFailure: null,
        pending: new Set(),
      });
    } else {
      // Same build after early `hydrate` (and any pre-settle edits): keep save status / pending
      // flushes, publish the caller's configuration snapshot, and narrow the catalog to what the
      // settled mesh can actually satisfy.
      this.setState({ configuration, catalog });
      if (!this.lastPersisted) this.lastPersisted = configuration;
    }

    const { failed } = await controller.applyConfiguration(
      configuration.selections,
      this.state.configuration?.paintStudio ?? configuration.paintStudio,
    );
    if (failed.length > 0) {
      this.setState({
        status: "error",
        error: `Could not apply saved options: ${failed.join(", ")}`,
        saveFailure: null,
      });
    }
  }

  detachScene(): void {
    this.controller = null;
  }

  reset(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.flushRequested = false;
    this.batchedOptionIds.clear();
    this.lastPersisted = null;
    this.conflictDraft = null;
    this.mutationVersion = 0;
    this.state = emptyState();
    for (const listener of this.listeners) listener();
  }

  selectOption(option: CustomizationOption): Promise<void> {
    const previous = this.sceneMutationQueue;
    const task = previous
      ? previous.then(() => this.selectOptionSerialized(option))
      : this.selectOptionSerialized(option);
    const tail = task.catch(() => undefined).finally(() => {
      if (this.sceneMutationQueue === tail) this.sceneMutationQueue = null;
    });
    this.sceneMutationQueue = tail;
    return task;
  }

  private async selectOptionSerialized(option: CustomizationOption): Promise<void> {
    const current = this.state.configuration;
    if (!current) return;

    const alreadyOn = isSelected(current.selections, option);
    if (alreadyOn && !isMultiSelect(option.category)) return;

    const selections = alreadyOn
      ? withOptionDeselected(current.selections, option)
      // The catalog is needed to resolve selection groups: a single-select choice must evict only
      // the other members of its own group, not everything filed under the category.
      : withOptionSelected(current.selections, option, this.state.catalog);

    // Selecting a catalog OEM paint exits custom studio while preserving the HDRI preset id.
    let paintStudio = current.paintStudio;
    if (option.category === "paint" && option.id !== PAINT_CUSTOM_OPTION_ID && !alreadyOn) {
      paintStudio = {
        mode: "oem",
        hdriPresetId: current.paintStudio?.hdriPresetId ?? DEFAULT_HDRI_PRESET_ID,
      };
    }

    const next: VehicleConfiguration = {
      ...current,
      selections,
      paintStudio,
      updatedAt: new Date().toISOString(),
    };

    this.mutationVersion += 1;
    this.conflictDraft = null;
    const pending = new Set(this.state.pending).add(option.id);
    this.setState({
      configuration: next,
      pending,
      status: "saving",
      error: null,
      saveFailure: null,
    });
    this.batchedOptionIds.add(option.id);
    trackOptionChanged({ category: option.category });

    const applied = await this.applyToScene(option, !alreadyOn);
    if (applied) this.queueFlush();
  }

  async replaceSelections(selections: SelectionMap): Promise<void> {
    const current = this.state.configuration;
    if (!current) return;

    const next: VehicleConfiguration = {
      ...current,
      selections,
      updatedAt: new Date().toISOString(),
    };
    this.mutationVersion += 1;
    this.conflictDraft = null;
    this.setState({
      configuration: next,
      status: "saving",
      error: null,
      saveFailure: null,
      pending: new Set(),
    });

    if (this.controller) {
      const { failed } = await this.controller.applyConfiguration(
        selections,
        this.state.configuration?.paintStudio,
      );
      if (failed.length > 0) {
        await this.rollback(`Could not apply options: ${failed.join(", ")}`);
        return;
      }
    }
    this.queueFlush();
  }

  /**
   * Updates OEM/custom paint-studio state. Custom material params are schema-safe numbers/hex —
   * GLB targets are applied via the scene controller's catalog constants.
   */
  async setPaintStudio(paintStudio: PaintStudioState, selections?: SelectionMap): Promise<void> {
    const current = this.state.configuration;
    if (!current) return;

    const next: VehicleConfiguration = {
      ...current,
      selections: selections ?? current.selections,
      paintStudio,
      updatedAt: new Date().toISOString(),
    };
    this.mutationVersion += 1;
    this.conflictDraft = null;
    this.setState({ configuration: next, status: "saving", error: null, saveFailure: null });

    if (this.controller) {
      const { failed } = await this.controller.applyConfiguration(next.selections, paintStudio);
      if (failed.length > 0) {
        await this.rollback(`Could not apply paint studio: ${failed.join(", ")}`);
        return;
      }
    }
    this.queueFlush();
  }

  private async applyToScene(option: CustomizationOption, enable: boolean): Promise<boolean> {
    const controller = this.controller;
    if (!controller) return true;

    const ok = enable ? await controller.applyOption(option) : await controller.removeOption(option);
    if (!ok) {
      await this.rollback(`"${option.label}" could not be applied to the model.`);
      return false;
    }
    return true;
  }

  setCameraState(cameraState: VehicleConfiguration["cameraState"]): void {
    const current = this.state.configuration;
    if (!current) return;
    this.mutationVersion += 1;
    this.conflictDraft = null;
    this.setState({ configuration: { ...current, cameraState }, status: "saving", saveFailure: null });
    this.queueFlush();
  }

  private queueFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), PERSIST_DEBOUNCE_MS);
  }

  /**
   * `keepalive` is for the `pagehide` path: browsers may abort an ordinary in-flight fetch as the
   * document unloads, which would drop a click made inside the debounce window.
   */
  async flush(options: { keepalive?: boolean } = {}): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;

    if (this.flushPromise) {
      this.flushRequested = true;
      await this.flushPromise;
      return;
    }

    this.flushPromise = this.performFlushLoop(options);
    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  private async performFlushLoop(options: { keepalive?: boolean } = {}): Promise<void> {
    do {
      this.flushRequested = false;
      const configuration = this.state.configuration;
      if (!configuration) return;

      const sentVersion = this.mutationVersion;
      const batched = [...this.batchedOptionIds];

      // Nothing to persist. Skipping the request matters beyond saving a round trip: after a
      // rollback the local state deliberately equals the server's record, so writing it back would
      // bump the revision and replace the "error" status with "saved", hiding the failure the user
      // needs to see. It also stops the `pagehide` flush writing on every ordinary page close.
      if (batched.length === 0 && this.matchesPersisted(configuration)) return;

      this.batchedOptionIds.clear();

      try {
        const saved = await configurationsApi.updateConfiguration(
          configuration.configurationId,
          {
            selections: configuration.selections,
            cameraState: configuration.cameraState,
            paintStudio: configuration.paintStudio,
            expectedRevision: this.lastPersisted?.revision,
          },
          options,
        );
        this.lastPersisted = saved;
        this.conflictDraft = null;
        trackSaveSucceeded({ surface: "auto" });

        if (this.mutationVersion === sentVersion) {
          this.setState({
            configuration: saved,
            status: "saved",
            error: null,
            saveFailure: null,
            pending: withoutIds(this.state.pending, batched),
          });
        } else {
          const newer = this.state.configuration;
          this.setState({
            configuration: newer
              ? { ...newer, revision: saved.revision, createdAt: saved.createdAt, updatedAt: saved.updatedAt }
              : saved,
            status: "saving",
            error: null,
            saveFailure: null,
            pending: withoutIds(this.state.pending, batched),
          });
          this.flushRequested = true;
        }
      } catch (error) {
        const reason = saveFailureReason(error);
        trackSaveFailed({ reason });
        // Worker-only conflict UX (#52): keep local edits visible and offer recovery. Local /
        // unknown mode keeps the historic rollback path so Pages demo behaviour is unchanged.
        if (isRevisionConflict(error) && configurationsApi.getPersistenceMode() === "worker") {
          await this.enterRevisionConflict(error, batched);
          return;
        }
        await this.rollback(messageForSaveFailure(error), batched, reason);
        return;
      }
    } while (this.flushRequested || this.batchedOptionIds.size > 0);
  }

  /** Whether the local record already matches what the server last confirmed. */
  private matchesPersisted(configuration: VehicleConfiguration): boolean {
    const persisted = this.lastPersisted;
    if (!persisted) return false;
    return (
      JSON.stringify(configuration.selections) === JSON.stringify(persisted.selections) &&
      JSON.stringify(configuration.cameraState ?? null) === JSON.stringify(persisted.cameraState ?? null) &&
      JSON.stringify(configuration.paintStudio ?? null) === JSON.stringify(persisted.paintStudio ?? null)
    );
  }

  /**
   * Stale-revision path (Worker mode only). Keeps the user's local edits on screen so reload /
   * overwrite / fork can use them; does not replay `lastPersisted` into the scene.
   */
  private async enterRevisionConflict(error: unknown, batched: string[]): Promise<void> {
    const draft = this.state.configuration;
    this.conflictDraft = draft;
    this.mutationVersion += 1;
    this.batchedOptionIds.clear();
    this.flushRequested = false;
    this.setState({
      status: "error",
      error: messageForSaveFailure(error),
      saveFailure: "conflict",
      pending: withoutIds(this.state.pending, batched.length ? batched : [...this.state.pending]),
    });
  }

  private async rollback(
    message: string,
    batched: string[] = [],
    saveFailure: SaveFailureReason | null = null,
  ): Promise<void> {
    const restored = this.lastPersisted;
    this.conflictDraft = null;
    this.mutationVersion += 1;
    this.batchedOptionIds.clear();
    this.flushRequested = false;
    this.setState({
      configuration: restored ?? this.state.configuration,
      status: "error",
      error: message,
      saveFailure,
      pending: withoutIds(this.state.pending, batched.length ? batched : [...this.state.pending]),
    });
    if (restored && this.controller) {
      await this.controller.applyConfiguration(restored.selections, restored.paintStudio);
    }
  }

  clearError(): void {
    if (this.state.status === "error") {
      this.conflictDraft = null;
      this.setState({ status: "idle", error: null, saveFailure: null });
    }
  }

  /** Whether the builder should offer Worker conflict recovery actions. */
  hasRevisionConflict(): boolean {
    return this.state.saveFailure === "conflict" && configurationsApi.getPersistenceMode() === "worker";
  }

  /**
   * One-click reload: fetch the server revision into the builder and clear the conflict.
   * Worker conflict recovery only.
   */
  async reloadServerRevision(): Promise<void> {
    const current = this.state.configuration;
    if (!current || !this.hasRevisionConflict()) return;

    const server = await configurationsApi.getConfiguration(current.configurationId);
    this.lastPersisted = server;
    this.conflictDraft = null;
    this.mutationVersion += 1;
    this.batchedOptionIds.clear();
    this.flushRequested = false;
    this.setState({
      configuration: server,
      status: "idle",
      error: null,
      saveFailure: null,
      pending: new Set(),
    });
    if (this.controller) {
      await this.controller.applyConfiguration(server.selections, server.paintStudio);
    }
  }

  /**
   * Force-overwrite the server copy with the retained local draft (omits `expectedRevision`).
   * Caller must confirm in the UI before invoking. Worker conflict recovery only.
   */
  async forceOverwrite(): Promise<void> {
    const draft = this.conflictDraft ?? this.state.configuration;
    if (!draft || !this.hasRevisionConflict()) return;

    this.setState({ status: "saving", error: null, saveFailure: null });
    try {
      const saved = await configurationsApi.updateConfiguration(draft.configurationId, {
        selections: draft.selections,
        cameraState: draft.cameraState,
        paintStudio: draft.paintStudio,
        // Intentionally omit expectedRevision — last-write-wins force overwrite (#52).
      });
      this.lastPersisted = saved;
      this.conflictDraft = null;
      this.mutationVersion += 1;
      trackSaveSucceeded({ surface: "auto" });
      this.setState({
        configuration: saved,
        status: "saved",
        error: null,
        saveFailure: null,
        pending: new Set(),
      });
    } catch (error) {
      const reason = saveFailureReason(error);
      trackSaveFailed({ reason });
      this.setState({
        configuration: draft,
        status: "error",
        error: messageForSaveFailure(error),
        saveFailure: reason === "conflict" ? "conflict" : reason,
      });
      if (reason === "conflict") this.conflictDraft = draft;
    }
  }

  /**
   * Fork the retained local edits into a brand-new configuration (new id), leaving the
   * conflicting server revision untouched. Worker conflict recovery only.
   */
  async forkLocalDraft(): Promise<VehicleConfiguration | null> {
    const draft = this.conflictDraft ?? this.state.configuration;
    if (!draft || !this.hasRevisionConflict()) return null;

    this.setState({ status: "saving", error: null, saveFailure: null });
    try {
      const fresh = await configurationsApi.createConfiguration({
        vehicleId: draft.vehicleId,
        modelYear: draft.modelYear,
        gradeId: draft.gradeId,
        selections: draft.selections,
        cameraState: draft.cameraState,
        paintStudio: draft.paintStudio,
      });
      this.lastPersisted = fresh;
      this.conflictDraft = null;
      this.mutationVersion += 1;
      this.batchedOptionIds.clear();
      this.flushRequested = false;
      this.setState({
        configuration: fresh,
        status: "saved",
        error: null,
        saveFailure: null,
        pending: new Set(),
      });
      trackSaveSucceeded({ surface: "auto" });
      if (this.controller) {
        await this.controller.applyConfiguration(fresh.selections, fresh.paintStudio);
      }
      return fresh;
    } catch (error) {
      const reason = saveFailureReason(error);
      trackSaveFailed({ reason });
      this.conflictDraft = draft;
      this.setState({
        configuration: draft,
        status: "error",
        error: messageForSaveFailure(error),
        saveFailure: "conflict",
      });
      return null;
    }
  }
}

function withoutIds(pending: Set<string>, ids: string[]): Set<string> {
  const next = new Set(pending);
  for (const id of ids) next.delete(id);
  return next;
}

export const configurationStore = new ConfigurationStore();
