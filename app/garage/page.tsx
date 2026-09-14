"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, GitCompare, Loader2, Share2, Trash2, Truck, Warehouse } from "lucide-react";
import { pageUrl, MAX_COMPARE, MIN_COMPARE } from "../../lib/api/client";
import { getPersistenceMode, subscribePersistenceMode, type PersistenceMode } from "../../lib/api/configurations";
import {
  loadGarageGroups,
  removeGarageBuild,
  type GarageGroup,
} from "../../lib/showroom/garage";
import {
  buildsToCompareDeepLinkInput,
  createCompareDeepLinkUrl,
  type CreateCompareDeepLinkResult,
} from "../../lib/showroom/compareDeepLink";
import { estimateBuildTotal, resolveGradeMsrp } from "../../lib/showroom/buildTools";
import { listVehicleOptions } from "../../lib/api/configurations";
import { getVehicle } from "../../lib/api/client";

export default function GaragePage() {
  const [groups, setGroups] = useState<GarageGroup[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [persistenceMode, setPersistenceMode] = useState<PersistenceMode>(() => getPersistenceMode());
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [shareMessage, setShareMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const next = await loadGarageGroups();
      setGroups(next);

      const nextTotals: Record<string, number> = {};
      for (const group of next) {
        for (const build of group.builds) {
          if (!build.configuration) continue;
          try {
            const [vehicle, catalog] = await Promise.all([
              getVehicle(build.configuration.vehicleId),
              listVehicleOptions(build.configuration.vehicleId, build.configuration.gradeId),
            ]);
            const base = resolveGradeMsrp(vehicle, build.configuration.gradeId);
            nextTotals[build.configuration.configurationId] = estimateBuildTotal(
              base,
              catalog,
              build.configuration,
            );
          } catch {
            // Estimate is optional chrome — leave blank on failure.
          }
        }
      }
      setTotals(nextTotals);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
      setGroups([]);
    }
  }, []);

  useEffect(() => {
    // Initial garage load after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bootstrap fetch
    void refresh();
  }, [refresh]);

  useEffect(() => subscribePersistenceMode(() => setPersistenceMode(getPersistenceMode())), []);

  const togglePicked = (configurationId: string) => {
    setPicked((current) => {
      if (current.includes(configurationId)) return current.filter((id) => id !== configurationId);
      if (current.length >= MAX_COMPARE) return current;
      return [...current, configurationId];
    });
  };

  const totalBuilds = useMemo(
    () => (groups ?? []).reduce((sum, group) => sum + group.builds.length, 0),
    [groups],
  );

  /** Prefer `?cmp=` deep link (vehicle + option ids) so a second browser can restore without D1 ids. */
  const compareShare: CreateCompareDeepLinkResult | null = useMemo(() => {
    if (picked.length < MIN_COMPARE || !groups) return null;
    const selected = [];
    for (const group of groups) {
      for (const build of group.builds) {
        if (!picked.includes(build.pin.configurationId)) continue;
        if (!build.configuration) continue;
        selected.push(build.configuration);
      }
    }
    if (selected.length < MIN_COMPARE) return null;
    return createCompareDeepLinkUrl(
      typeof window !== "undefined" ? window.location.origin : "https://example.invalid",
      pageUrl("compare"),
      buildsToCompareDeepLinkInput(selected.slice(0, MAX_COMPARE)),
    );
  }, [picked, groups]);

  const shareCompareLink = async () => {
    if (!compareShare) return;
    if (!compareShare.ok) {
      setShareMessage(compareShare.message);
      return;
    }
    try {
      await navigator.clipboard.writeText(compareShare.url);
      setShareMessage("Compare link copied — opens the same build set without cloud ids");
    } catch {
      setShareMessage(compareShare.url);
      try {
        window.prompt("Copy this garage compare link", compareShare.url);
      } catch {
        /* ignore non-interactive prompt failures */
      }
    }
  };

  const onRemove = async (configurationId: string, canMutate: boolean) => {
    const message = canMutate
      ? "Delete this saved build permanently? This uses your owner token."
      : "Remove this build from your garage list? You do not have the owner token, so the stored record will not be deleted.";
    if (!window.confirm(message)) return;
    setBusyId(configurationId);
    try {
      await removeGarageBuild(configurationId);
      setPicked((current) => current.filter((id) => id !== configurationId));
      await refresh();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="explore-shell garage-shell">
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
        <h1>
          <Warehouse size={28} aria-hidden /> My garage
        </h1>
        <p>
          Saved builds across 4Runner, AE86, Tacoma, and Camry. Pick {MIN_COMPARE}–{MAX_COMPARE} to
          compare option categories side by side.
        </p>
        {persistenceMode === "local" ? (
          <p className="garage-persistence-note" data-testid="garage-persistence-note">
            Demo / offline mode — builds stay in this browser (localStorage), not Worker/D1.
          </p>
        ) : null}
      </header>

      {loadError ? (
        <div className="config-error" role="alert">
          <span>{loadError}</span>
          <button onClick={() => setLoadError(null)}>Dismiss</button>
        </div>
      ) : null}

      {groups === null ? (
        <p className="panel-empty">
          <Loader2 className="spin" size={16} aria-hidden /> Loading garage…
        </p>
      ) : null}

      {groups && totalBuilds === 0 ? (
        <p className="panel-empty" data-testid="garage-empty">
          No saved builds yet. Open a vehicle builder and tap <strong>Save build</strong> to pin it
          here.
        </p>
      ) : null}

      {groups && totalBuilds > 0 ? (
        <div className="garage-groups" data-testid="garage-groups">
          {groups.map((group) => (
            <section key={group.vehicleId} className="garage-group" data-vehicle={group.vehicleId}>
              <header className="garage-group-header">
                <h2>
                  {group.year ? `${group.year} ` : ""}
                  {group.model}
                </h2>
                <span>
                  {group.builds.length} build{group.builds.length === 1 ? "" : "s"}
                </span>
              </header>
              <ul className="garage-build-list">
                {group.builds.map((build) => {
                  const id = build.pin.configurationId;
                  const checked = picked.includes(id);
                  const total = totals[id];
                  return (
                    <li key={id} className="garage-build-card" data-testid="garage-build-card">
                      <label className={checked ? "garage-build-pick active" : "garage-build-pick"}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!checked && picked.length >= MAX_COMPARE}
                          onChange={() => togglePicked(id)}
                          aria-label={`Select ${build.pin.model} build ${id} for compare`}
                        />
                        <div>
                          <strong>
                            {build.pin.label ?? `${build.pin.model} · ${build.pin.gradeId}`}
                          </strong>
                          <small>
                            {id}
                            {build.configuration
                              ? ` · rev ${build.configuration.revision}`
                              : build.loadError
                                ? ` · ${build.loadError}`
                                : ""}
                            {typeof total === "number" ? ` · est. $${total.toLocaleString()}` : ""}
                          </small>
                          {!build.canMutate ? (
                            <small className="garage-readonly-hint">
                              Read-only here — no owner token in this browser
                            </small>
                          ) : null}
                        </div>
                      </label>
                      <div className="garage-build-actions">
                        <a
                          className="ghost"
                          href={`${pageUrl(build.pin.vehicleId)}#configuration=${encodeURIComponent(id)}`}
                        >
                          Open builder
                        </a>
                        <button
                          type="button"
                          className="ghost danger"
                          disabled={busyId === id}
                          onClick={() => void onRemove(id, build.canMutate)}
                          title={
                            build.canMutate
                              ? "Delete build (requires owner token)"
                              : "Unpin from garage (no owner token)"
                          }
                        >
                          <Trash2 size={14} />
                          {build.canMutate ? "Delete" : "Unpin"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : null}

      {shareMessage ? (
        <div
          className={shareMessage.startsWith("Compare link is too long") || shareMessage.startsWith("Select ") ? "config-error" : "garage-share-toast"}
          role="status"
          data-testid="garage-compare-share-message"
        >
          <span>{shareMessage}</span>
          <button
            type="button"
            onClick={() => {
              setShareMessage(null);
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {picked.length > 0 ? (
        <div className="compare-bar garage-compare-bar" role="region" aria-label="Compare selected builds">
          <GitCompare size={16} aria-hidden />
          <span>
            {picked.length} build{picked.length === 1 ? "" : "s"} selected
            {picked.length < MIN_COMPARE ? ` (need ${MIN_COMPARE})` : ""}
          </span>
          {picked.length >= MIN_COMPARE ? (
            compareShare?.ok ? (
              <>
                <a
                  className="primary"
                  href={compareShare.url}
                  data-testid="garage-compare-link"
                >
                  Compare builds
                </a>
                <button
                  type="button"
                  className="ghost"
                  data-testid="garage-compare-share"
                  onClick={() => void shareCompareLink()}
                >
                  <Share2 size={14} aria-hidden /> Copy link
                </button>
              </>
            ) : compareShare && !compareShare.ok ? (
              <button
                type="button"
                className="primary"
                data-testid="garage-compare-share-error"
                onClick={() => setShareMessage(compareShare.message)}
              >
                Link too long — details
              </button>
            ) : (
              <a
                className="primary"
                href={`${pageUrl("compare")}?builds=${picked.join(",")}`}
                data-testid="garage-compare-link"
              >
                Compare builds
              </a>
            )
          ) : (
            <span className="compare-bar-hint">Select at least {MIN_COMPARE} builds</span>
          )}
          <button type="button" onClick={() => setPicked([])}>
            Clear
          </button>
        </div>
      ) : null}
    </main>
  );
}
