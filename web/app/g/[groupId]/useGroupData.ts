"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getBalance, getGroup, listEntries } from "@/lib/api";
import type { components } from "@/lib/api-types";

type GroupRecord = components["schemas"]["GroupRecord"];
type BalanceSnapshot = components["schemas"]["BalanceSnapshot"];
type EntryRecord = components["schemas"]["EntryRecord"];

const POLL_INTERVAL_MS = 5000;

/**
 * Loads `groupId` once, then keeps `balance` and `entries` fresh: an
 * immediate poll as soon as the group is known, then every 5s while the tab
 * is visible (a `visibilitychange` listener re-polls immediately on refocus
 * rather than waiting for the next tick). `entries` accumulates across polls
 * — each poll only asks for what's new via `after_seq`, cursored on the
 * highest `seq` seen so far.
 */
export function useGroupData(groupId: string) {
  const [group, setGroup] = useState<GroupRecord | null>(null);
  const [balance, setBalance] = useState<BalanceSnapshot | null>(null);
  const [entries, setEntries] = useState<EntryRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setGroup(null);
    setBalance(null);
    setEntries([]);
    setError(null);
    cursorRef.current = 0;

    getGroup(groupId)
      .then((g) => {
        if (!cancelled) setGroup(g);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load group.");
      });

    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const refresh = useCallback(async () => {
    try {
      const [nextBalance, page] = await Promise.all([
        getBalance(groupId),
        listEntries(groupId, cursorRef.current || undefined),
      ]);
      setBalance(nextBalance);
      if (page.entries.length > 0) {
        cursorRef.current = Math.max(cursorRef.current, ...page.entries.map((e) => e.seq));
        setEntries((prev) => [...prev, ...page.entries]);
      }
      // A poll error is transient — clear it so the next successful poll
      // (5s later, or on refocus) recovers the page instead of leaving it
      // stuck on a stale error from a one-off network blip.
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to refresh group data.");
    }
  }, [groupId]);

  useEffect(() => {
    if (!group) return;

    refresh();

    function tick() {
      if (document.visibilityState === "visible") refresh();
    }

    const interval = setInterval(tick, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [group, refresh]);

  return { group, balance, entries, error, refresh };
}
