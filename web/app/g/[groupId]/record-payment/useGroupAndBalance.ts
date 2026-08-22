"use client";

import { useQuery } from "@tanstack/react-query";
import { balanceQueryOptions, groupQueryOptions } from "@/lib/queries";

/**
 * Loads `groupId`'s members and current balances for the record-payment
 * form — the counterparty list needs balances to put creditors first. Shares
 * `groupQueryOptions`/`balanceQueryOptions` with `useGroupData`, so `group`
 * is cache-warm arriving from either the group home or the settle screen;
 * the settle screen's `useSettlePlan` never queries `balance`, so that one
 * still does a fresh fetch either way.
 *
 * Note there is no `refetchInterval` here, unlike `useGroupData`'s balance
 * query — the shared options carry key and fetcher only, so polling stays a
 * per-screen decision. Nothing in this screen's history explains the
 * difference, so treat it as load-bearing until someone establishes
 * otherwise rather than adding a poll for symmetry.
 */
export function useGroupAndBalance(groupId: string) {
  const groupQuery = useQuery(groupQueryOptions(groupId));

  const balanceQuery = useQuery({
    ...balanceQueryOptions(groupId),
    enabled: groupQuery.isSuccess,
  });

  return {
    group: groupQuery.data,
    balance: balanceQuery.data,
    error: (groupQuery.error ?? balanceQuery.error)?.message ?? null,
  };
}
