"use client";

/**
 * Recovery alert for a `?cmp=` deep link that arrives malformed (issue-free gap found in the
 * compare page's restore path). Deep links are the only way another browser can restore a build
 * comparison without D1 ids, and the encode side already treats ~2KB as the truncation risk zone
 * (`COMPARE_DEEP_LINK_MAX_URL_LENGTH` — "many messengers / QR contexts truncate near 2KB"). The
 * decode side, though, surfaced the raw internal `ApiError` message ("Compare deep-link payload
 * is not valid base64url.") in a generic alert: validation jargon with no next step, next to a
 * line still claiming the build set was "restored from deep link".
 *
 * Like `PersistenceModeBanner`, this is a tiny presentational surface with exported copy
 * constants so tests pin the strings without mounting the compare page. The page keeps the raw
 * error in the console for debugging and renders this instead:
 *   - plain-language title/body explaining the likely truncation and the recovery paths;
 *   - "Clear link and pick builds" — `history.replaceState` strips `?cmp=` (and sibling deep-link
 *     params) without a reload, and the page drops back to the catalog picker;
 *   - Dismiss for the rare case someone wants to inspect the URL.
 */

export const COMPARE_DEEP_LINK_BROKEN_COPY = {
  title: "This compare link is damaged or incomplete",
  body: "The link was probably cut off in transit (messaging apps and some QR contexts truncate long URLs). Ask for the link to be sent again, or start a fresh comparison below.",
  dismissLabel: "Dismiss",
  resetLabel: "Clear link and pick builds",
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
