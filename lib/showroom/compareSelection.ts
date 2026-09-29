/**
 * Reconciles a `?vehicles=` catalog-compare selection against the slugs the catalog actually has.
 *
 * `/compare?vehicles=…` is a shareable link a visitor can edit by hand, and the catalog can lose a
 * model between the link being written and opened (a retired name, a typo, a truncated copy). The
 * picker has no checkbox for a slug it doesn't know, so keeping such a slug in the selection made
 * the page contradict itself: it consumed a slot of the `MAX_COMPARE` cap and was re-written into
 * the "Update comparison" link, so a link naming one unknown vehicle could silently cap the picker
 * at `MAX_COMPARE - 1` visible picks and never let the visitor resolve it.
 *
 * Both halves are returned: `selected` is what the checkboxes, the cap and the link must use, and
 * `dropped` is what the page reports back to the visitor instead of discarding it in silence.
 * Input order is preserved and duplicates are removed on both sides, so the result is a pure
 * function of the selection and the catalog, not of how the URL happened to be spelled.
 */
export function reconcileCompareSelection(
  picked: readonly string[],
  knownSlugs: Iterable<string>,
): { selected: string[]; dropped: string[] } {
  const known = new Set(knownSlugs);
  const selected: string[] = [];
  const dropped: string[] = [];

  for (const slug of picked) {
    if (known.has(slug)) {
      if (!selected.includes(slug)) selected.push(slug);
    } else if (!dropped.includes(slug)) {
      dropped.push(slug);
    }
  }

  return { selected, dropped };
}