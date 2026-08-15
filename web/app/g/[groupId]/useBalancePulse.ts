"use client";

import { useEffect, useRef, useState } from "react";
import { diffChangedBalanceIds } from "@/lib/balance";
import type { components } from "@/lib/api-types";

type MemberBalance = components["schemas"]["MemberBalance"];

// Matches useCopyInviteLink's CONFIRMATION_MS and design-handoff.md's
// ~1.6s ease-out pulse spec.
export const PULSE_MS = 1600;

/**
 * Tracks which balance rows should show the design handoff's pulse
 * highlight right now (issue #56). One timer per member id — polls land
 * every 5s (`POLL_INTERVAL_MS`), well past `PULSE_MS`, but per-id timers
 * keep independently-timed changes from clobbering each other's clocks.
 */
export function useBalancePulse(balances: MemberBalance[] | undefined): Set<string> {
  const previousRef = useRef<MemberBalance[] | undefined>(undefined);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [pulsingIds, setPulsingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (balances === undefined) return;
    const changed = diffChangedBalanceIds(previousRef.current, balances);
    previousRef.current = balances;
    if (changed.size === 0) return;

    setPulsingIds((prev) => new Set([...prev, ...changed]));
    for (const id of changed) {
      const existingTimer = timersRef.current.get(id);
      if (existingTimer !== undefined) clearTimeout(existingTimer);
      timersRef.current.set(
        id,
        setTimeout(() => {
          setPulsingIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          timersRef.current.delete(id);
        }, PULSE_MS),
      );
    }
  }, [balances]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  return pulsingIds;
}
