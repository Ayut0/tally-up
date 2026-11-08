"use client";

import { useQuery } from "@tanstack/react-query";
import { EntryKind } from "@/lib/entry";
import { allEntriesQueryOptions, groupQueryOptions } from "@/lib/queries";

/**
 * Loads the group and one of its entries for the detail/edit screens.
 * `reversed` is true once a reversal entry points at it — an edited or
 * deleted entry stays readable but is no longer editable.
 */
export function useEntry(groupId: string, entryId: string) {
  const groupQuery = useQuery(groupQueryOptions(groupId));
  const entriesQuery = useQuery(allEntriesQueryOptions(groupId));

  const entries = entriesQuery.data;
  const entry = entries?.find((e) => e.id === entryId && e.kind !== EntryKind.Reversal);
  const reversed = !!entries?.some(
    (e) => e.kind === EntryKind.Reversal && e.reverses_id === entryId,
  );

  return {
    group: groupQuery.data,
    entry,
    reversed,
    loading: !groupQuery.data || !entries,
    error: groupQuery.error?.message ?? entriesQuery.error?.message ?? null,
  };
}
