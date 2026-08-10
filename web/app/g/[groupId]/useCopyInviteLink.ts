"use client";

import { useState } from "react";

const CONFIRMATION_MS = 1600;

/**
 * design-handoff.md's "Copy link" affordance: the invite link *is* the
 * whole invite mechanism, so a silent copy isn't good enough — `copied`
 * drives a visible confirmation (label swap/toast) for a short window.
 */
export function useCopyInviteLink() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), CONFIRMATION_MS);
  }

  return { copied, copy };
}
