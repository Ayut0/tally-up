"use client";

import { useQuery } from "@tanstack/react-query";
import { groupQueryOptions, pairwiseBalancesQueryOptions } from "@/lib/queries";

const POLL_INTERVAL_MS = 5000;

/**
 * Loads `groupId`'s members and true pairwise debt, polling on the same
 * terms as the group home/settle screens (5s, paused while the tab is
 * hidden, refetched on refocus — TanStack Query's defaults). The group query
 * comes from the same `groupQueryOptions` as every other group-scoped
 * screen, so arriving from the group home is cache-warm.
 */
export function useOwes(groupId: string) {
  const groupQuery = useQuery(groupQueryOptions(groupId));

  const pairsQuery = useQuery({
    ...pairwiseBalancesQueryOptions(groupId),
    enabled: groupQuery.isSuccess,
    refetchInterval: POLL_INTERVAL_MS,
  });

  return {
    group: groupQuery.data,
    pairs: pairsQuery.data?.balances,
    error: (groupQuery.error ?? pairsQuery.error)?.message ?? null,
  };
}
