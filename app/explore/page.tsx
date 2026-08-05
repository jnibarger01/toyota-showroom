"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, GitCompare, Loader2, Truck } from "lucide-react";
import { listVehicles, pageUrl, MAX_COMPARE } from "../../lib/api/client";
import { matchesFilters, paginateAndFilter, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../lib/api/query";
import type { BodyStyle, VehicleSummary } from "../../lib/types/vehicle";

const BODY_STYLE_LABELS: Record<BodyStyle, string> = {
  suv: "SUV",
  truck: "Truck",
  sedan: "Sedan",
  minivan: "Minivan",
  crossover: "Crossover",
  coupe: "Coupe",
  hatchback: "Hatchback",
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
  const [compareSlugs, setCompareSlugs] = useState<string[]>([]);
  const [page, setPage] = useState(1);

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

  const bodyStyles = useMemo(
    () => Array.from(new Set((allSummaries ?? []).map((summary) => summary.bodyStyle))).sort(),
    [allSummaries],
  );

  const filtered = useMemo(
    () =>
      (allSummaries ?? []).filter(
        (summary) => !bodyStyle || matchesFilters(summary, { bodyStyle: [bodyStyle] }),
      ),
    [allSummaries, bodyStyle],
  );

  // A filter change can leave `page` pointing past the new, smaller result set (e.g. on page 3 of
  // "All", then switching to a body style with only one page) — reset during render rather than in
  // an effect (React's own recommended "adjusting state when a prop changes" pattern: an effect
  // here would let a stale page briefly render, then commit a second time to fix it).
  const [prevBodyStyle, setPrevBodyStyle] = useState(bodyStyle);
  if (bodyStyle !== prevBodyStyle) {
    setPrevBodyStyle(bodyStyle);
    setPage(1);
  }

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
    <main className="explore-shell">
      <header className="explore-header">
        <a className="brand" href={pageUrl()}>
          <Truck size={24} />
          <div>
            <strong>TOYOTA</strong>
            <span>SHOWROOM</span>
          </div>
        </a>
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

      {allSummaries === null && !loadError ? (
        <div className="explore-loading">
          <Loader2 size={20} className="spin" /> Loading lineup&hellip;
        </div>
      ) : null}

      {allSummaries !== null && filtered.length === 0 ? (
        <p className="panel-empty">No vehicles match that filter.</p>
      ) : null}

      <div className="vehicle-grid">
        {paged.data.map((summary) => {
          const checked = compareSlugs.includes(summary.slug);
          return (
            <a key={summary.slug} className="vehicle-card" href={pageUrl(summary.slug)}>
              <div className="vehicle-card-media">
                <img src={summary.thumbnail.url} alt={summary.thumbnail.alt} loading="lazy" />
                {summary.availability !== "in_production" ? (
                  <span className="vehicle-card-badge">{AVAILABILITY_LABELS[summary.availability]}</span>
                ) : null}
              </div>
              <div className="vehicle-card-body">
                <span className="vehicle-card-year">{summary.year} &middot; {BODY_STYLE_LABELS[summary.bodyStyle]}</span>
                <h2>{summary.model}</h2>
                <div className="vehicle-card-specs">
                  <span>Seats {summary.maxSeating}</span>
                  {summary.maxTowingLbs > 0 ? <span>{summary.maxTowingLbs.toLocaleString()} lb tow</span> : null}
                </div>
                <p className="vehicle-card-price">Starting at ${summary.startingMsrp.toLocaleString()}</p>
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
