import {
  isMultiSelect,
  isSelected,
  withOptionDeselected,
  withOptionSelected,
  type CustomizationOption,
  type VehicleConfiguration,
} from "../types/customization";
import type { VehicleSceneController } from "../three/sceneController";
import * as configurationsApi from "../api/configurations";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface ConfigurationState {
  configuration: VehicleConfiguration | null;
  catalog: CustomizationOption[];
  status: SaveStatus;
  error: string | null;
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
  private flushPromise: Promise<void> | null = null;
  private flushRequested = false;
  private mutationVersion = 0;
  private lastPersisted: VehicleConfiguration | null = null;
  private batchedOptionIds = new Set<string>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ConfigurationState => this.state;

  private setState(patch: Partial<ConfigurationState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  async attachScene(
    controller: VehicleSceneController,
    configuration: VehicleConfiguration,
    catalog: CustomizationOption[],
  ): Promise<void> {
    this.controller = controller;
    this.lastPersisted = configuration;
    this.mutationVersion = 0;
    this.setState({ configuration, catalog, status: "idle", error: null, pending: new Set() });

    const { failed } = await controller.applyConfiguration(configuration.selections);
    if (failed.length > 0) {
      this.setState({ status: "error", error: `Could not apply saved options: ${failed.join(", ")}` });
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
    this.mutationVersion = 0;
    this.state = emptyState();
    for (const listener of this.listeners) listener();
  }

  async selectOption(option: CustomizationOption): Promise<void> {
    const current = this.state.configuration;
    if (!current) return;

    const alreadyOn = isSelected(current.selections, option);
    if (alreadyOn && !isMultiSelect(option.category)) return;

    const selections = alreadyOn
      ? withOptionDeselected(current.selections, option)
      // The catalog is needed to resolve selection groups: a single-select choice must evict only
      // the other members of its own group, not everything filed under the category.
      : withOptionSelected(current.selections, option, this.state.catalog);
    const next: VehicleConfiguration = {
      ...current,
      selections,
      updatedAt: new Date().toISOString(),
    };

    this.mutationVersion += 1;
    const pending = new Set(this.state.pending).add(option.id);
    this.setState({ configuration: next, pending, status: "saving", error: null });
    this.batchedOptionIds.add(option.id);

    const applied = await this.applyToScene(option, !alreadyOn);
    if (applied) this.queueFlush();
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
    this.setState({ configuration: { ...current, cameraState }, status: "saving" });
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
            expectedRevision: this.lastPersisted?.revision,
          },
          options,
        );
        this.lastPersisted = saved;

        if (this.mutationVersion === sentVersion) {
          this.setState({
            configuration: saved,
            status: "saved",
            error: null,
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
            pending: withoutIds(this.state.pending, batched),
          });
          this.flushRequested = true;
        }
      } catch (error) {
        await this.rollback(error instanceof Error ? error.message : String(error), batched);
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
      JSON.stringify(configuration.cameraState ?? null) === JSON.stringify(persisted.cameraState ?? null)
    );
  }

  private async rollback(message: string, batched: string[] = []): Promise<void> {
    const restored = this.lastPersisted;
    this.mutationVersion += 1;
    this.batchedOptionIds.clear();
    this.flushRequested = false;
    this.setState({
      configuration: restored ?? this.state.configuration,
      status: "error",
      error: message,
      pending: withoutIds(this.state.pending, batched.length ? batched : [...this.state.pending]),
    });
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
