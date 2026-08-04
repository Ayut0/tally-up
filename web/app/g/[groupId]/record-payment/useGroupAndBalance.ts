"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError, getBalance, getGroup } from "@/lib/api";
import type { components } from "@/lib/api-types";

type GroupRecord = components["schemas"]["GroupRecord"];
type BalanceSnapshot = components["schemas"]["BalanceSnapshot"];

/**
 * Loads `groupId`'s members and current balances for the record-payment
 * form — the counterparty list needs balances to put creditors first. Same
 * query keys as `useGroupData`'s group/balance queries, so arriving here
 * from the group home or settle screen is cache-warm.
 */
export function useGroupAndBalance(groupId: string) {
  const groupQuery = useQuery<GroupRecord, ApiError>({
    queryKey: ["group", groupId],
    queryFn: () => getGroup(groupId),
  });

  const balanceQuery = useQuery<BalanceSnapshot, ApiError>({
    queryKey: ["balance", groupId],
    queryFn: () => getBalance(groupId),
    enabled: groupQuery.isSuccess,
  });

  return {
    group: groupQuery.data,
    balance: balanceQuery.data,
    error: (groupQuery.error ?? balanceQuery.error)?.message ?? null,
  };
}
