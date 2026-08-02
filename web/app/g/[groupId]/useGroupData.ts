"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError, getBalance, getGroup, listEntries } from "@/lib/api";
import type { components } from "@/lib/api-types";

type GroupRecord = components["schemas"]["GroupRecord"];
type BalanceSnapshot = components["schemas"]["BalanceSnapshot"];
type EntryList = components["schemas"]["EntryList"];

const POLL_INTERVAL_MS = 5000;

/**
 * Loads `groupId`'s group, then keeps balance and entries fresh once it's
 * known. TanStack Query's defaults already give this the behavior it needs:
 * `refetchIntervalInBackground: false` (default) pauses the 5s poll while
 * the tab is hidden, and `refetchOnWindowFocus` (also default) re-polls
 * immediately on refocus. Each poll re-fetches the full entries list rather
 * than an `after_seq`-cursored incremental one — simpler and race-free (no
 * client-held cursor for a concurrent interval-tick/refocus poll to race
 * on), and the backend has no pagination cap to make that expensive.
 */
export function useGroupData(groupId: string) {
  const groupQuery = useQuery<GroupRecord, ApiError>({
    queryKey: ["group", groupId],
    queryFn: () => getGroup(groupId),
  });

  const balanceQuery = useQuery<BalanceSnapshot, ApiError>({
    queryKey: ["balance", groupId],
    queryFn: () => getBalance(groupId),
    enabled: groupQuery.isSuccess,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const entriesQuery = useQuery<EntryList, ApiError>({
    queryKey: ["entries", groupId],
    queryFn: () => listEntries(groupId),
    enabled: groupQuery.isSuccess,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const queryError = groupQuery.error ?? balanceQuery.error ?? entriesQuery.error;

  return {
    group: groupQuery.data,
    balance: balanceQuery.data,
    entries: entriesQuery.data?.entries ?? [],
    error: queryError?.message ?? null,
  };
}
