"use client";

import { useSyncExternalStore } from "react";
import {
  getPersistenceMode,
  subscribePersistenceMode,
  type PersistenceMode,
} from "../api/configurations";
import { configurationStore, type ConfigurationState } from "./configurationStore";
import {
  CATEGORY_APPLY_ORDER,
  isSelected,
  type CustomizationCategory,
  type CustomizationOption,
} from "../types/customization";

/**
 * React binding for the configuration store.
 *
 * `useSyncExternalStore` is given the store's identity-stable snapshot, so a re-render happens only
 * when the store actually replaces state — clicking the already-selected paint chip does not.
 */
export function useConfiguration(): ConfigurationState {
  return useSyncExternalStore(
    configurationStore.subscribe,
    configurationStore.getSnapshot,
    configurationStore.getSnapshot,
  );
}

export interface CategoryView {
  category: CustomizationCategory;
  options: CustomizationOption[];
}

/** Groups the verified catalog into the deterministic category order used everywhere else. */
export function useCatalogByCategory(): CategoryView[] {
  const { catalog } = useConfiguration();
  return CATEGORY_APPLY_ORDER.map((category) => ({
    category,
    options: catalog.filter((option) => option.category === category),
  })).filter((view) => view.options.length > 0);
}

export function useIsSelected(option: CustomizationOption): boolean {
  const { configuration } = useConfiguration();
  return configuration ? isSelected(configuration.selections, option) : false;
}


/** React binding for Worker vs local (Pages demo) persistence detection. */
export function usePersistenceMode(): PersistenceMode {
  return useSyncExternalStore(subscribePersistenceMode, getPersistenceMode, getPersistenceMode);
}

export { configurationStore };
