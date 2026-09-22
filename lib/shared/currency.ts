/**
 * Locale-aware currency formatting for catalog MSRP, option `priceDelta`s, and financing totals.
 *
 * ## Default locale / currency
 *
 * Catalog sticker prices and deltas are authored as **USD** whole-dollar figures
 * (`Vehicle.pricing.currency` is `"USD"`). Amounts remain USD (this is not FX conversion), while
 * presentation follows the explicit locale, the browser's UI locale, or `en-US` as a fallback.
 *
 * This is **not** FX conversion. Amounts remain USD; only presentation is localized. Callers that
 * need cents (rare in this catalog) can pass `maximumFractionDigits` / `minimumFractionDigits`.
 */

export const DEFAULT_CURRENCY_LOCALE = "en-US" as const;
export const DEFAULT_CURRENCY_CODE = "USD" as const;

export type FormatCurrencyOptions = {
  /** Override the presentation locale (defaults to `navigator.language` when available). */
  locale?: string;
  /** Override max fraction digits (default `0` — whole-dollar sticker / financing display). */
  maximumFractionDigits?: number;
  /** Override min fraction digits (default matches `maximumFractionDigits`). */
  minimumFractionDigits?: number;
  /**
   * When true, show a leading `+` / `−` via `signDisplay: "exceptZero"` (option chips, upgrades).
   * Absolute MSRP / totals leave this off.
   */
  signed?: boolean;
};

const formatterCache = new Map<string, Intl.NumberFormat>();

function cacheKey(
  locale: string,
  options: Required<Pick<FormatCurrencyOptions, "maximumFractionDigits" | "minimumFractionDigits" | "signed">>,
): string {
  return `${locale}:${options.maximumFractionDigits}:${options.minimumFractionDigits}:${options.signed ? "s" : "u"}`;
}

/** Resolve the locale used for currency presentation without changing the USD currency. */
export function resolveCurrencyLocale(explicit?: string): string {
  if (explicit) return explicit;
  if (typeof navigator !== "undefined" && navigator.language) return navigator.language;
  return DEFAULT_CURRENCY_LOCALE;
}

function getCurrencyFormatter(options: FormatCurrencyOptions = {}): Intl.NumberFormat {
  const locale = resolveCurrencyLocale(options.locale);
  const maximumFractionDigits = options.maximumFractionDigits ?? 0;
  const minimumFractionDigits = options.minimumFractionDigits ?? maximumFractionDigits;
  const signed = options.signed ?? false;
  const key = cacheKey(locale, { maximumFractionDigits, minimumFractionDigits, signed });
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: DEFAULT_CURRENCY_CODE,
      maximumFractionDigits,
      minimumFractionDigits,
      ...(signed ? { signDisplay: "exceptZero" as const } : {}),
    });
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/**
 * Format a USD amount using the explicit locale, browser locale, or `en-US` fallback.
 *
 * Rounds half-away-from-zero per `Intl.NumberFormat` (e.g. `579.5` → `$580` at 0 fraction digits).
 */
export function formatCurrency(amount: number, options?: FormatCurrencyOptions): string {
  return getCurrencyFormatter(options).format(amount);
}

/**
 * Format an option / upgrade delta with an explicit sign (`+$1,150`, `-$425`).
 * Zero formats as `$0` (no sign) via `signDisplay: "exceptZero"`.
 */
export function formatPriceDelta(delta: number, options?: Omit<FormatCurrencyOptions, "signed">): string {
  return formatCurrency(delta, { ...options, signed: true });
}
