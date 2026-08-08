"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError, getGroup, getPairwiseBalances } from "@/lib/api";
import type { components } from "@/lib/api-types";

type GroupRecord = components["schemas"]["GroupRecord"];
type PairwiseBalances = components["schemas"]["PairwiseBalances"];

const POLL_INTERVAL_MS = 5000;

/**
 * Loads `groupId`'s members and true pairwise debt, polling on the same
 * terms as the group home/settle screens (5s, paused while the tab is
 * hidden, refetched on refocus — TanStack Query's defaults). The group query
 * shares its key with `useGroupData`, so arriving from the group home is
 * cache-warm.
 */
export function useOwes(groupId: string) {
  const groupQuery = useQuery<GroupRecord, ApiError>({
    queryKey: ["group", groupId],
    queryFn: () => getGroup(groupId),
  });

  const pairsQuery = useQuery<PairwiseBalances, ApiError>({
    queryKey: ["pairwise-balances", groupId],
    queryFn: () => getPairwiseBalances(groupId),
    enabled: groupQuery.isSuccess,
    refetchInterval: POLL_INTERVAL_MS,
  });

  return {
    group: groupQuery.data,
    pairs: pairsQuery.data?.balances,
    error: (groupQuery.error ?? pairsQuery.error)?.message ?? null,
  };
}
