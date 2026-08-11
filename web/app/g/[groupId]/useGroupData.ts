"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError, getBalance, getGroup } from "@/lib/api";
import type { components } from "@/lib/api-types";

type GroupRecord = components["schemas"]["GroupRecord"];
type BalanceSnapshot = components["schemas"]["BalanceSnapshot"];

export const POLL_INTERVAL_MS = 5000;

/**
 * Loads `groupId`'s group, then keeps balance fresh once it's known.
 * TanStack Query's defaults already give this the behavior it needs:
 * `refetchIntervalInBackground: false` (default) pauses the 5s poll while
 * the tab is hidden, and `refetchOnWindowFocus` (also default) re-polls
 * immediately on refocus. Entries live in `useGroupHistory` (#221) — a
 * separate hook because, unlike balance, entries page.
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

  const queryError = groupQuery.error ?? balanceQuery.error;

  return {
    group: groupQuery.data,
    balance: balanceQuery.data,
    error: queryError?.message ?? null,
  };
}
