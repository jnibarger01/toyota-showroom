"use client";

/**
 * Demo/offline persistence disclaimer (#77).
 *
 * Product-critical copy that has drifted in full-chrome snapshots before. Kept as a tiny
 * presentational surface + exported constants so unit tests can pin the strings without
 * mounting BuilderApp / garage chrome.
 *
 * - `local`  — Pages demo / offline: show the banner (saves are browser-only).
 * - `worker` — Cloudflare Worker + D1: no banner (production path needs no disclaimer).
 * - `unknown` — detection still pending: no banner (avoid a flash of demo copy on Worker).
 */

import { CloudOff } from "lucide-react";
import type { PersistenceMode } from "../../lib/api/configurations";

export const PERSISTENCE_MODE_BANNER_COPY = {
  local: {
    title: "Demo / offline saves",
    body:
      "builds stay in this browser. Share uses a deep link so others can open your build without Worker/D1. Production persistence is Cloudflare Worker + D1; see the deployment runbook to promote.",
  },
} as const;

/** Garage header note when saves are localStorage-only (same product surface as the builder banner). */
export const GARAGE_PERSISTENCE_NOTE_COPY =
  "Demo / offline mode — builds stay in this browser (localStorage), not Worker/D1.";

type Props = {
  mode: PersistenceMode;
};

export function PersistenceModeBanner({ mode }: Props) {
  if (mode !== "local") return null;

  const copy = PERSISTENCE_MODE_BANNER_COPY.local;

  return (
    <div className="persistence-banner" role="status" data-testid="persistence-mode-banner">
      <CloudOff size={15} aria-hidden />
      <span>
        <strong>{copy.title}</strong> — {copy.body}
      </span>
    </div>
  );
}
