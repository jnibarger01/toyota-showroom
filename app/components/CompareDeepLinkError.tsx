"use client";

/**
 * Recovery alert for a `?cmp=` deep link that cannot be restored. A failure can mean transport
 * corruption/truncation or a structurally valid but stale link whose model/grade/options no longer
 * exist in the current catalog. The page keeps the raw error in the console for debugging and
 * renders recovery copy that is accurate for both cases:
 *   - plain-language title/body covering damaged, incomplete, and stale links;
 *   - "Clear link and compare vehicles" — `history.replaceState` strips `?cmp=` (and sibling deep-link
 *     params) without a reload, and the page drops back to the catalog picker;
 *   - Dismiss for the rare case someone wants to inspect the URL.
 */

export const COMPARE_DEEP_LINK_BROKEN_COPY = {
  title: "This compare link can’t be restored",
  body: "The link may be incomplete, damaged, or refer to vehicle or option data that is no longer available. Ask for a new link, or start a fresh vehicle comparison below.",
  dismissLabel: "Dismiss",
  resetLabel: "Clear link and compare vehicles",
} as const;

type Props = {
  onReset: () => void;
  onDismiss: () => void;
};

export function CompareDeepLinkError({ onReset, onDismiss }: Props) {
  const copy = COMPARE_DEEP_LINK_BROKEN_COPY;

  return (
    <div className="config-error compare-deeplink-error" role="alert" data-testid="compare-deeplink-error">
      <div className="config-error-conflict-inner">
        <p className="compare-deeplink-error-title">{copy.title}</p>
        <p className="compare-deeplink-error-body">{copy.body}</p>
      </div>
      <div className="config-error-actions">
        <button
          type="button"
          className="primary"
          data-testid="compare-deeplink-reset"
          onClick={onReset}
        >
          {copy.resetLabel}
        </button>
        <button type="button" data-testid="compare-deeplink-dismiss" onClick={onDismiss}>
          {copy.dismissLabel}
        </button>
      </div>
    </div>
  );
}
