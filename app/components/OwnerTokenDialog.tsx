"use client";

/**
 * One-time owner-token reveal after the first explicit "Save build" (#31 / #80).
 *
 * The API returns plaintext exactly once at create; the client remembers it for PATCH/DELETE.
 * This dialog is the only UI that may put that secret in the DOM — and only until the user
 * dismisses it. `markOwnerTokenShown` then prevents refresh / re-save from re-showing the raw value.
 */

import { useCallback, useState } from "react";
import { AlertTriangle, Check, Copy, Download, KeyRound, X } from "lucide-react";

export const OWNER_TOKEN_DIALOG_COPY = {
  title: "Save your owner token",
  body: "This secret lets you edit or delete this build later. Copy or download it now — it will not be shown again after you close this dialog.",
  recoveryHint:
    "Recovery: if you lose this token, another browser or device cannot prove ownership. This browser may still edit while the token remains stored locally.",
  copyLabel: "Copy owner token",
  copiedLabel: "Copied — keep this somewhere safe",
  downloadLabel: "Download token",
  dismissLabel: "I saved my token",
  dismissWarn:
    "You have not copied or downloaded the owner token. Without it, you may lose edit rights on other devices. Close anyway?",
} as const;

type Props = {
  configurationId: string;
  ownerToken: string;
  onDismiss: () => void;
};

export function OwnerTokenDialog({ configurationId, ownerToken, onDismiss }: Props) {
  const [copied, setCopied] = useState(false);
  const [secured, setSecured] = useState(false);

  const copyToken = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(ownerToken);
      setCopied(true);
      setSecured(true);
    } catch {
      try {
        window.prompt("Copy this owner token", ownerToken);
        setSecured(true);
      } catch {
        /* non-interactive */
      }
    }
  }, [ownerToken]);

  const downloadToken = useCallback(() => {
    const blob = new Blob(
      [
        `Toyota Showroom owner token\n`,
        `configurationId: ${configurationId}\n`,
        `ownerToken: ${ownerToken}\n`,
        `\nKeep this secret. It is required to edit or delete this build from another device.\n`,
      ],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `toyota-showroom-owner-token-${configurationId}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    setSecured(true);
  }, [configurationId, ownerToken]);

  const dismiss = useCallback(() => {
    if (!secured) {
      const ok = window.confirm(OWNER_TOKEN_DIALOG_COPY.dismissWarn);
      if (!ok) return;
    }
    onDismiss();
  }, [onDismiss, secured]);

  return (
    <div
      className="owner-token-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="owner-token-dialog-title"
      data-testid="owner-token-dialog"
    >
      <button type="button" className="tour-close" aria-label="Close owner token dialog" onClick={dismiss}>
        <X size={15} />
      </button>
      <div className="owner-token-dialog-heading">
        <KeyRound size={16} aria-hidden />
        <strong id="owner-token-dialog-title">{OWNER_TOKEN_DIALOG_COPY.title}</strong>
      </div>
      <p>{OWNER_TOKEN_DIALOG_COPY.body}</p>
      <code className="owner-token-value" data-testid="owner-token-value">
        {ownerToken}
      </code>
      <p className="owner-token-recovery" data-testid="owner-token-recovery-hint">
        <AlertTriangle size={13} aria-hidden /> {OWNER_TOKEN_DIALOG_COPY.recoveryHint}
      </p>
      <div className="owner-token-actions">
        <button type="button" className="primary" data-testid="owner-token-copy" onClick={() => void copyToken()}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? OWNER_TOKEN_DIALOG_COPY.copiedLabel : OWNER_TOKEN_DIALOG_COPY.copyLabel}
        </button>
        <button type="button" data-testid="owner-token-download" onClick={downloadToken}>
          <Download size={14} /> {OWNER_TOKEN_DIALOG_COPY.downloadLabel}
        </button>
        <button type="button" data-testid="owner-token-dismiss" onClick={dismiss}>
          {OWNER_TOKEN_DIALOG_COPY.dismissLabel}
        </button>
      </div>
    </div>
  );
}
