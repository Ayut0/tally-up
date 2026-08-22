"use client";

import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, addEntry } from "@/lib/api";
import type { components } from "@/lib/api-types";
import { todayLocal } from "@/lib/date";
import { getIdentity } from "@/lib/identity";
import {
  balanceQueryOptions,
  entriesKey,
  groupQueryOptions,
  settlePlanQueryOptions,
} from "@/lib/queries";
import { settlementFor, transferKey } from "@/lib/settle";
import { generateUuidV7 } from "@/lib/uuidv7";

type Transfer = components["schemas"]["Transfer"];
type EntryAck = components["schemas"]["EntryAck"];

const POLL_INTERVAL_MS = 5000;

/**
 * Loads `groupId`'s members and its settle plan, keeping the plan fresh on the
 * same terms as the group home (`useGroupData`): TanStack Query's defaults
 * pause the 5s poll while the tab is hidden (`refetchIntervalInBackground:
 * false`) and re-poll on refocus (`refetchOnWindowFocus`). The group query
 * comes from the shared `groupQueryOptions`, so arriving from the home is
 * cache-warm.
 *
 * That refresh is the *only* defence against two people recording the same
 * cash handover (issue #150) — the server rejects no duplicate, because it
 * cannot tell one from a genuine second payment. So callers MUST render rows
 * straight from `plan.transfers` and keep no copy of it: a transfer dropped by
 * a recompute then stops being tappable by not existing, rather than by a
 * guard someone can forget to write.
 */
export function useSettlePlan(groupId: string) {
  const groupQuery = useQuery(groupQueryOptions(groupId));

  const planQuery = useQuery({
    ...settlePlanQueryOptions(groupId),
    enabled: groupQuery.isSuccess,
    refetchInterval: POLL_INTERVAL_MS,
  });

  return {
    group: groupQuery.data,
    plan: planQuery.data,
    error: (groupQuery.error ?? planQuery.error)?.message ?? null,
  };
}

/**
 * Records a proposed transfer as a settlement for exactly the proposed amount,
 * then invalidates what the write moved: this screen's plan, and the group
 * home's balance and entries so neither is stale on the way back.
 */
export function useRecordTransfer(groupId: string) {
  const queryClient = useQueryClient();

  // One {entry id, idempotency key} per proposed transfer, kept across renders
  // so retrying after a failure replays onto the server's idempotency gate
  // rather than recording a second payment — a failure may have been a lost
  // response to a write that committed. Same reasoning as add-expense's
  // `submissionRef`, keyed by the transfer instead of by a form payload.
  const intents = useRef(new Map<string, { id: string; key: string }>());

  const mutation = useMutation<EntryAck, ApiError, Transfer>({
    mutationFn: (transfer) => {
      const key = transferKey(transfer);
      let intent = intents.current.get(key);
      if (!intent) {
        intent = { id: generateUuidV7(), key: generateUuidV7() };
        intents.current.set(key, intent);
      }
      // Whoever is holding this browser recorded the payment, so the entry is
      // theirs to undo (#146/#159) — not the payer's. Same fallback shape as
      // add-expense: without a picked identity, attribute it to the payer.
      // Near-unreachable here, since the group home gates on JoinPicker before
      // it will show the link that reaches this screen.
      const requestedBy = getIdentity(groupId) ?? transfer.from;
      const record = { id: intent.id, requestedBy, occurredOn: todayLocal() };
      return addEntry(groupId, settlementFor(transfer, record), intent.key);
    },
    onSuccess: (_ack, transfer) => {
      // Drop the intent: an identical transfer proposed again later is a new
      // payment, and replaying this key would return the settled one instead
      // of recording it.
      intents.current.delete(transferKey(transfer));
      queryClient.invalidateQueries({ queryKey: settlePlanQueryOptions(groupId).queryKey });
      queryClient.invalidateQueries({ queryKey: balanceQueryOptions(groupId).queryKey });
      // The prefix, not one window: history may be holding a live window and
      // any number of paged-older queries, and all of them just went stale.
      queryClient.invalidateQueries({ queryKey: entriesKey(groupId) });
    },
  });

  return {
    record: mutation.mutate,
    // Two separate facts on purpose. `recording` is the safety one — the screen
    // disables every row on it — so it must not depend on `variables` being
    // readable. `pendingKey` only decides which row says "Recording…".
    recording: mutation.isPending,
    pendingKey: mutation.isPending && mutation.variables ? transferKey(mutation.variables) : null,
    error: mutation.error?.message ?? null,
  };
}
