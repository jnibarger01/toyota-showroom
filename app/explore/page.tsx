"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Truck } from "lucide-react";
import { listVehicles, pageUrl } from "../../lib/api/client";
import { matchesFilters, MAX_PAGE_SIZE } from "../../lib/api/query";
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
        {filtered.map((summary) => (
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
            </div>
          </a>
        ))}
      </div>
    </main>
  );
}
