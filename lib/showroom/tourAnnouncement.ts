/**
 * Phrasing for cinematic-tour scene changes (#71).
 *
 * Distinct from selection announcements (#51): those report paint/option changes on the build;
 * these report which camera scene the tour has moved to. Mixing them in one live region would
 * let a chip click overwrite a tour step mid-sentence (and the reverse), so the builder mounts
 * two polite regions and this helper only ever feeds the tour one.
 *
 * Pure so unit tests can assert the spoken sentence without mounting React or GSAP.
 */

export type TourSceneLabel = {
  label: string;
};

/**
 * One short sentence naming the active tour scene for a screen reader.
 *
 * Uses the catalog `label` (Hero, Wheels, Interior) rather than the preset id — ids are stable
 * for code, labels are what a listener should hear.
 */
export function describeTourScene(preset: TourSceneLabel): string {
  return `Tour scene: ${preset.label}.`;
}
