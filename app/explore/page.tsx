"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, GitCompare, Loader2, Truck, X } from "lucide-react";
import { listVehicles, pageUrl, MAX_COMPARE } from "../../lib/api/client";
import { loadExploreInventoryBadges } from "../../lib/api/dealerInventory";
import { ValidatedLeadForm } from "../components/ValidatedLeadForm";
import { matchesFilters, paginateAndFilter, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type VehicleFilters } from "../../lib/api/query";
import type { InventoryBadge } from "../../lib/dealerInventory";
import type { BodyStyle, PowertrainType, VehicleSummary } from "../../lib/types/vehicle";
import { formatCurrency } from "../../lib/shared/currency";

const INVENTORY_BADGE_LABELS: Record<InventoryBadge, string> = {
  near_me: "Near me",
  buildable: "Buildable",
};

const BODY_STYLE_LABELS: Record<BodyStyle, string> = {
  suv: "SUV",
  truck: "Truck",
  sedan: "Sedan",
  minivan: "Minivan",
  crossover: "Crossover",
  coupe: "Coupe",
  hatchback: "Hatchback",
};

const POWERTRAIN_LABELS: Record<PowertrainType, string> = {
  gas: "Gas",
  hybrid: "Hybrid",
  phev: "Plug-in Hybrid",
  bev: "Electric",
};

const AVAILABILITY_LABELS: Record<VehicleSummary["availability"], string> = {
  in_production: "In production",
  coming_soon: "Coming soon",
  discontinued: "Discontinued",
};

export default function ExplorePage() {
  const [allSummaries, setAllSummaries] = useState<VehicleSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bodyStyle, setBodyStyle] = useState<BodyStyle | null>(null);
  const [powertrainTypes, setPowertrainTypes] = useState<PowertrainType[]>([]);
  const [minPrice, setMinPrice] = useState<number | null>(null);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [minSeating, setMinSeating] = useState<number | null>(null);
  const [compareSlugs, setCompareSlugs] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  // Inventory badges load independently of the catalog so a slow/failed dealer feed never blocks
  // the lineup (#20). `null` = still pending or skipped; empty object = loaded with no matches.
  const [inventoryBadges, setInventoryBadges] = useState<ReadonlyMap<string, InventoryBadge[]> | null>(null);
  const [inventoryError, setInventoryError] = useState(false);
  const [leadVehicle, setLeadVehicle] = useState<VehicleSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The full catalog, unfiltered: filtering happens client-side below via `matchesFilters` so
    // the body-style chips can stay populated with every style the lineup offers, not just the
    // ones matching whatever is currently selected.
    void listVehicles({}, { page: 1, pageSize: MAX_PAGE_SIZE })
      .then((result) => {
        if (!cancelled) setAllSummaries(result.data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Dealer inventory match is explicitly non-blocking: kicked off after (and in parallel with)
  // catalog load, swallowed on failure, and never consulted before cards render.
  useEffect(() => {
    if (allSummaries === null) return;
    let cancelled = false;
    void loadExploreInventoryBadges(allSummaries.map((summary) => summary.slug))
      .then((badges) => {
        if (!cancelled) {
          setInventoryBadges(badges);
          setInventoryError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInventoryBadges(new Map());
          setInventoryError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [allSummaries]);

  const bodyStyles = useMemo(
    () => Array.from(new Set((allSummaries ?? []).map((summary) => summary.bodyStyle))).sort(),
    [allSummaries],
  );

  const powertrainOptions = useMemo(
    () => Array.from(new Set((allSummaries ?? []).flatMap((summary) => summary.powertrainTypes))).sort(),
    [allSummaries],
  );

  // Combines every facet into the one `VehicleFilters` shape `matchesFilters` (lib/api/query.ts)
  // already understands server-side — the same object the API's own query params resolve to, so a
  // chip here and a `?minSeating=` URL param can never disagree about what counts as a match.
  const facetFilters: VehicleFilters = useMemo(
    () => ({
      ...(bodyStyle ? { bodyStyle: [bodyStyle] } : {}),
      ...(powertrainTypes.length ? { powertrainType: powertrainTypes } : {}),
      ...(minPrice !== null ? { minPrice } : {}),
      ...(maxPrice !== null ? { maxPrice } : {}),
      ...(minSeating !== null ? { minSeating } : {}),
    }),
    [bodyStyle, powertrainTypes, minPrice, maxPrice, minSeating],
  );
  const hasActiveFacets = Object.keys(facetFilters).length > 0;

  const filtered = useMemo(
    () => (allSummaries ?? []).filter((summary) => matchesFilters(summary, facetFilters)),
    [allSummaries, facetFilters],
  );

  // A filter change can leave `page` pointing past the new, smaller result set (e.g. on page 3 of
  // "All", then narrowing to a facet combination with only one page) — reset during render rather
  // than in an effect (React's own recommended "adjusting state when a prop changes" pattern: an
  // effect here would let a stale page briefly render, then commit a second time to fix it).
  // Keyed on the combined filter object (not just `bodyStyle` alone) so every facet — powertrain,
  // price, seating — triggers the same reset, not only the original body-style chips.
  const filtersKey = JSON.stringify(facetFilters);
  const [prevFiltersKey, setPrevFiltersKey] = useState(filtersKey);
  if (filtersKey !== prevFiltersKey) {
    setPrevFiltersKey(filtersKey);
    setPage(1);
  }

  const togglePowertrain = (type: PowertrainType) => {
    setPowertrainTypes((current) =>
      current.includes(type) ? current.filter((t) => t !== type) : [...current, type],
    );
  };

  const clearFacets = () => {
    setBodyStyle(null);
    setPowertrainTypes([]);
    setMinPrice(null);
    setMaxPrice(null);
    setMinSeating(null);
  };

  // Filtering happens above, over the full catalog (needed so the body-style chips always show
  // every style the lineup offers — see the fetch effect's own comment). Pagination is a second,
  // independent pass over the already-filtered result: `paginateAndFilter`'s own filter step is a
  // no-op here (`{}`), only its page-math is used, so changing the filter and changing the page
  // never fight over what "page 2" means.
  const paged = useMemo(() => paginateAndFilter(filtered, {}, { page, pageSize: DEFAULT_PAGE_SIZE }), [filtered, page]);

  const toggleCompare = (slug: string) => {
    setCompareSlugs((current) => {
      if (current.includes(slug)) return current.filter((id) => id !== slug);
      // Silently caps rather than rejecting: a disabled checkbox already prevents picking a 5th
      // vehicle, so reaching this branch would mean state and UI disagreed with each other.
      if (current.length >= MAX_COMPARE) return current;
      return [...current, slug];
    });
  };

  return (
    <main id="main-content" className="explore-shell" tabIndex={-1}>
      <header className="explore-header">
        <a className="brand" href={pageUrl()}>
          <Truck size={24} />
          <div>
            <strong>TOYOTA</strong>
            <span>SHOWROOM</span>
          </div>
        </a>
        <nav className="explore-nav">
          <a href={pageUrl("garage")}>Garage</a>
          <a href={pageUrl("compare")}>Compare</a>
        </nav>
        <h1>Explore the lineup</h1>
        <p>Pick a model to open its 3D builder.</p>
      </header>

      {loadError ? (
        <div className="config-error" role="alert">
          <span>Couldn&rsquo;t load the lineup: {loadError}</span>
          <button onClick={() => setLoadError(null)}>Dismiss</button>
        </div>
      ) : null}

      {bodyStyles.length > 1 ? (
        <div className="explore-filters" role="group" aria-label="Filter by body style">
          <button className={bodyStyle === null ? "active" : ""} onClick={() => setBodyStyle(null)}>
            All
          </button>
          {bodyStyles.map((style) => (
            <button
              key={style}
              className={bodyStyle === style ? "active" : ""}
              onClick={() => setBodyStyle(style)}
            >
              {BODY_STYLE_LABELS[style]}
            </button>
          ))}
        </div>
      ) : null}

      {allSummaries !== null ? (
        <div className="explore-facets">
          {powertrainOptions.length > 1 ? (
            <div className="explore-facet" role="group" aria-label="Filter by powertrain">
              <span className="explore-facet-label">Powertrain</span>
              <div className="explore-facet-checks">
                {powertrainOptions.map((type) => (
                  <label key={type}>
                    <input
                      type="checkbox"
                      checked={powertrainTypes.includes(type)}
                      onChange={() => togglePowertrain(type)}
                    />
                    {POWERTRAIN_LABELS[type]}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div className="explore-facet">
            <span className="explore-facet-label">Price</span>
            <div className="explore-facet-range">
              <input
                type="number"
                inputMode="numeric"
                placeholder="Min"
                aria-label="Minimum price"
                min={0}
                step="1000"
                value={minPrice ?? ""}
                onChange={(event) => setMinPrice(event.target.value === "" ? null : Number(event.target.value))}
              />
              <span>&ndash;</span>
              <input
                type="number"
                inputMode="numeric"
                placeholder="Max"
                aria-label="Maximum price"
                min={0}
                step="1000"
                value={maxPrice ?? ""}
                onChange={(event) => setMaxPrice(event.target.value === "" ? null : Number(event.target.value))}
              />
            </div>
          </div>

          <div className="explore-facet">
            <label className="explore-facet-label" htmlFor="explore-min-seating">Min. seating</label>
            <input
              id="explore-min-seating"
              type="number"
              inputMode="numeric"
              placeholder="Any"
              min={0}
              max={9}
              step="1"
              value={minSeating ?? ""}
              onChange={(event) => setMinSeating(event.target.value === "" ? null : Number(event.target.value))}
            />
          </div>

          {hasActiveFacets ? (
            <button className="explore-facet-clear" onClick={clearFacets}>
              <X size={13} /> Clear filters
            </button>
          ) : null}
        </div>
      ) : null}

      {allSummaries === null && !loadError ? (
        <div className="explore-loading">
          <Loader2 size={20} className="spin" /> Loading lineup&hellip;
        </div>
      ) : null}

      {allSummaries !== null && filtered.length === 0 ? (
        <p className="panel-empty">No vehicles match that filter.</p>
      ) : null}

      {allSummaries !== null && inventoryBadges !== null && (inventoryError || inventoryBadges.size === 0) ? (
        <div className="sr-only" aria-live="polite" role="status">
          {inventoryError
            ? "Dealer inventory is unavailable right now."
            : "No matching dealer inventory is available for these vehicles."}
        </div>
      ) : null}

      <div className="vehicle-grid">
        {paged.data.map((summary) => {
          const checked = compareSlugs.includes(summary.slug);
          return (
            <a key={summary.slug} className="vehicle-card" href={pageUrl(summary.slug)}>
              <div className="vehicle-card-media">
                <img src={summary.thumbnail.url} alt={summary.thumbnail.alt} loading="lazy" />
                <div className="vehicle-card-badges">
                  {summary.hasModel ? <span className="vehicle-card-badge">3D available</span> : null}
                  {summary.availability !== "in_production" ? (
                    <span className="vehicle-card-badge">{AVAILABILITY_LABELS[summary.availability]}</span>
                  ) : null}
                  {(inventoryBadges?.get(summary.slug) ?? []).map((badge) => (
                    <span
                      key={badge}
                      className={`vehicle-card-badge vehicle-card-badge--${badge === "near_me" ? "near-me" : "buildable"}`}
                    >
                      {INVENTORY_BADGE_LABELS[badge]}
                    </span>
                  ))}
                </div>
              </div>
              <div className="vehicle-card-body">
                <span className="vehicle-card-year">{summary.year} &middot; {BODY_STYLE_LABELS[summary.bodyStyle]}</span>
                <h2>{summary.model}</h2>
                <div className="vehicle-card-specs">
                  <span>Seats {summary.maxSeating}</span>
                  {summary.maxTowingLbs > 0 ? <span>{summary.maxTowingLbs.toLocaleString()} lb tow</span> : null}
                </div>
                <p className="vehicle-card-price">Starting at {formatCurrency(summary.startingMsrp)}</p>
                <span className="vehicle-card-action">{summary.hasModel ? "Configure 3D build" : "View details"}</span>
                <button
                  type="button"
                  className="vehicle-card-action"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setLeadVehicle(summary);
                  }}
                >
                  Request a test drive
                </button>
                <label
                  className="vehicle-card-compare"
                  // The card itself is the link; this control must not trigger that navigation.
                  onClick={(event) => event.preventDefault()}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && compareSlugs.length >= MAX_COMPARE}
                    onChange={() => toggleCompare(summary.slug)}
                  />
                  Compare
                </label>
              </div>
            </a>
          );
        })}
      </div>

      {leadVehicle ? (
        <div className="owner-token-dialog" role="dialog" aria-modal="true" aria-labelledby="explore-lead-form-title">
          <button type="button" className="tour-close" aria-label="Close test drive request" onClick={() => setLeadVehicle(null)}><X size={15} /></button>
          <div className="owner-token-dialog-heading"><Truck size={16} aria-hidden /><strong id="explore-lead-form-title">Request a test drive</strong></div>
          <p>Tell us how to reach you about the {leadVehicle.model}.</p>
          <ValidatedLeadForm buildSnapshot={{ vehicleId: leadVehicle.slug, gradeId: "default", selections: {}, shareUrl: new URL(pageUrl(leadVehicle.slug), window.location.origin).toString(), ownerTokenPresent: false }} />
        </div>
      ) : null}

      {paged.totalPages > 1 ? (
        <nav className="explore-pagination" aria-label="Lineup pages">
          <button onClick={() => setPage((current) => current - 1)} disabled={paged.page <= 1}>
            <ChevronLeft size={16} /> Previous
          </button>
          <span>
            Page {paged.page} of {paged.totalPages}
          </span>
          <button onClick={() => setPage((current) => current + 1)} disabled={paged.page >= paged.totalPages}>
            Next <ChevronRight size={16} />
          </button>
        </nav>
      ) : null}

      {compareSlugs.length > 0 ? (
        <div className="compare-bar">
          <span>
            <GitCompare size={16} /> {compareSlugs.length} selected
          </span>
          {compareSlugs.length >= 2 ? (
            <a className="primary" href={`${pageUrl("compare")}?vehicles=${compareSlugs.join(",")}`}>
              Compare
            </a>
          ) : (
            <span className="compare-bar-hint">Pick at least one more to compare</span>
          )}
          <button className="ghost" onClick={() => setCompareSlugs([])}>
            Clear
          </button>
        </div>
      ) : null}
    </main>
  );
}
