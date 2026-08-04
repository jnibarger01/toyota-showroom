"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Truck } from "lucide-react";
import { compareVehicles, listVehicles, pageUrl, MAX_COMPARE, MIN_COMPARE } from "../../lib/api/client";
import type { SpecCategory, Vehicle, VehicleSummary } from "../../lib/types/vehicle";

const SPEC_CATEGORY_ORDER: SpecCategory[] = [
  "dimensions",
  "capability",
  "performance",
  "safety",
  "technology",
  "comfort",
  "warranty",
];

const SPEC_CATEGORY_LABELS: Record<SpecCategory, string> = {
  dimensions: "Dimensions",
  capability: "Capability",
  performance: "Performance",
  safety: "Safety",
  technology: "Technology",
  comfort: "Comfort",
  warranty: "Warranty",
};

function parseSlugsFromSearch(search: string): string[] {
  const raw = new URLSearchParams(search).get("vehicles") ?? "";
  const slugs = raw.split(",").map((slug) => slug.trim()).filter(Boolean);
  return Array.from(new Set(slugs));
}

function startingMsrp(vehicle: Vehicle): number {
  return Math.min(vehicle.pricing.baseMsrp, ...vehicle.grades.map((grade) => grade.msrp));
}

function maxSeating(vehicle: Vehicle): number {
  return Math.max(...vehicle.grades.map((grade) => grade.seating));
}

function drivetrains(vehicle: Vehicle): string {
  const values = new Set(Object.values(vehicle.powertrains).map((p) => p.drivetrain.toUpperCase()));
  return Array.from(values).join(" / ") || "—";
}

function powertrainTypes(vehicle: Vehicle): string {
  const labels: Record<string, string> = { gas: "Gas", hybrid: "Hybrid", phev: "Plug-in hybrid", bev: "Electric" };
  const values = new Set(Object.values(vehicle.powertrains).map((p) => labels[p.type] ?? p.type));
  return Array.from(values).join(" / ") || "—";
}

function formatSpecValue(value: string | number | boolean, unit?: string): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return unit ? `${value.toLocaleString()} ${unit}` : value.toLocaleString();
  return value;
}

/** Row definition built from the union of every compared vehicle's spec `key`s within a category. */
type SpecRow = { key: string; label: string; category: SpecCategory; bySlug: Map<string, string> };

function buildSpecRows(vehicles: Vehicle[]): SpecRow[] {
  const rows = new Map<string, SpecRow>();
  for (const vehicle of vehicles) {
    for (const entry of vehicle.specs) {
      const row = rows.get(entry.key) ?? { key: entry.key, label: entry.label, category: entry.category, bySlug: new Map() };
      row.bySlug.set(vehicle.slug, formatSpecValue(entry.value, entry.unit));
      rows.set(entry.key, row);
    }
  }
  return Array.from(rows.values());
}

export default function ComparePage() {
  const [allSummaries, setAllSummaries] = useState<VehicleSummary[] | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Starts empty on both the server prerender and the client's first paint — a lazy initializer
  // reading `window.location.search` directly was tried first and reverted: it renders the "Update
  // comparison" link (gated on `picked.length >= MIN_COMPARE`) on the client's very first paint
  // whenever `?vehicles=` already names 2+ slugs, while the prerendered HTML has no such link
  // (`window` doesn't exist at prerender time, so that lazy initializer always saw `[]` there) —
  // a real server/client mismatch, React error #418, reproduced by loading this page with a
  // populated `?vehicles=` query and confirmed gone once seeding moved into the effect below.
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    // Deliberately not flagged by react-hooks/set-state-in-effect's usual "don't derive state from
    // props/state in an effect" case: `window.location.search` isn't reactive state this effect
    // re-syncs against on every change (the empty deps array is not a placeholder for "should
    // depend on something" — there is nothing to depend on), it's a browser-only value read once,
    // after mount, specifically so the SSR/hydration passes agree — the standard, React-endorsed
    // shape for exactly this problem.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPicked(parseSlugsFromSearch(window.location.search).slice(0, MAX_COMPARE));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listVehicles({}, { page: 1, pageSize: 50 })
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

  // `picked` filtered to slugs the catalog actually knows about — a stale or hand-edited
  // `?vehicles=` query string can never reach `compareVehicles` with something it would reject.
  const validSlugs = useMemo(() => {
    if (!allSummaries) return null;
    const known = new Set(allSummaries.map((summary) => summary.slug));
    return picked.filter((slug) => known.has(slug));
  }, [picked, allSummaries]);

  const canCompare = (validSlugs?.length ?? 0) >= MIN_COMPARE;

  useEffect(() => {
    // Nothing to synchronize until there are enough valid slugs; `vehicles` simply stays whatever
    // it last was; render-time gating on `canCompare` (below) — not this effect — decides whether
    // that stale value is ever shown.
    if (!validSlugs || !canCompare) return;
    let cancelled = false;
    void compareVehicles(validSlugs)
      .then((result) => {
        if (!cancelled) setVehicles(result);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [validSlugs, canCompare]);

  const specRows = useMemo(() => (vehicles ? buildSpecRows(vehicles) : []), [vehicles]);
  const rowsByCategory = useMemo(
    () =>
      SPEC_CATEGORY_ORDER.map((category) => ({
        category,
        rows: specRows.filter((row) => row.category === category),
      })).filter((group) => group.rows.length > 0),
    [specRows],
  );

  const togglePicked = (slug: string) => {
    setPicked((current) => {
      if (current.includes(slug)) return current.filter((id) => id !== slug);
      if (current.length >= MAX_COMPARE) return current;
      return [...current, slug];
    });
  };

  return (
    <main className="explore-shell compare-shell">
      <header className="explore-header">
        <a className="brand" href={pageUrl()}>
          <Truck size={24} />
          <div>
            <strong>TOYOTA</strong>
            <span>SHOWROOM</span>
          </div>
        </a>
        <a className="compare-back" href={pageUrl("explore")}>
          <ArrowLeft size={14} /> Back to lineup
        </a>
        <h1>Compare vehicles</h1>
        <p>Pick {MIN_COMPARE}–{MAX_COMPARE} models to see them side by side.</p>
      </header>

      {loadError ? (
        <div className="config-error" role="alert">
          <span>{loadError}</span>
          <button onClick={() => setLoadError(null)}>Dismiss</button>
        </div>
      ) : null}

      <div className="compare-picker" role="group" aria-label="Choose vehicles to compare">
        {(allSummaries ?? []).map((summary) => (
          <label key={summary.slug} className={picked.includes(summary.slug) ? "compare-pick active" : "compare-pick"}>
            <input
              type="checkbox"
              checked={picked.includes(summary.slug)}
              disabled={!picked.includes(summary.slug) && picked.length >= MAX_COMPARE}
              onChange={() => togglePicked(summary.slug)}
            />
            {summary.year} {summary.model}
          </label>
        ))}
        {picked.length >= MIN_COMPARE ? (
          <a className="primary compare-apply" href={`${pageUrl("compare")}?vehicles=${picked.join(",")}`}>
            Update comparison
          </a>
        ) : null}
      </div>

      {allSummaries !== null && !canCompare ? (
        <p className="panel-empty">
          Select at least {MIN_COMPARE} vehicles above to compare them.
        </p>
      ) : null}

      {vehicles && canCompare ? (
        <div className="compare-table-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th />
                {vehicles.map((vehicle) => (
                  <th key={vehicle.slug}>
                    <img src={vehicle.media.thumbnails[0]?.url ?? vehicle.media.hero.url} alt={vehicle.media.hero.alt} />
                    <span>{vehicle.year} {vehicle.model}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>Starting MSRP</th>
                {vehicles.map((vehicle) => <td key={vehicle.slug}>${startingMsrp(vehicle).toLocaleString()}</td>)}
              </tr>
              <tr>
                <th>Body style</th>
                {vehicles.map((vehicle) => <td key={vehicle.slug}>{vehicle.bodyStyle}</td>)}
              </tr>
              <tr>
                <th>Seating</th>
                {vehicles.map((vehicle) => <td key={vehicle.slug}>Up to {maxSeating(vehicle)}</td>)}
              </tr>
              <tr>
                <th>Powertrain</th>
                {vehicles.map((vehicle) => <td key={vehicle.slug}>{powertrainTypes(vehicle)}</td>)}
              </tr>
              <tr>
                <th>Drivetrain</th>
                {vehicles.map((vehicle) => <td key={vehicle.slug}>{drivetrains(vehicle)}</td>)}
              </tr>
              <tr>
                <th>Availability</th>
                {vehicles.map((vehicle) => <td key={vehicle.slug}>{vehicle.availability.replace("_", " ")}</td>)}
              </tr>
            </tbody>
            {rowsByCategory.map(({ category, rows }) => (
              <tbody key={category}>
                <tr className="compare-category-row">
                  <th colSpan={vehicles.length + 1}>{SPEC_CATEGORY_LABELS[category]}</th>
                </tr>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <th>{row.label}</th>
                    {vehicles.map((vehicle) => <td key={vehicle.slug}>{row.bySlug.get(vehicle.slug) ?? "—"}</td>)}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      ) : null}
    </main>
  );
}
