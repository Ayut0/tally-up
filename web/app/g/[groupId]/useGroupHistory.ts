"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiError, listEntries } from "@/lib/api";
import type { components } from "@/lib/api-types";
import { POLL_INTERVAL_MS } from "./useGroupData";

type EntryRecord = components["schemas"]["EntryRecord"];
type EntryList = components["schemas"]["EntryList"];

export const PAGE_SIZES = [10, 20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
const DEFAULT_PAGE_SIZE: PageSize = 20;

// Ceiling for the "everything since the paging boundary" live query below —
// the backend clamps limit to this anyway (maxListLimit in reads.go), so
// this just makes the ceiling explicit instead of relying on the server's
// default (100).
const LIVE_TAIL_LIMIT = 500;

/**
 * Loads and pages `groupId`'s ledger history (#221).
 *
 * Before any "Load more": the *live window* is the latest `pageSize`
 * entries, polling every 5s (same cadence/simple-refetch shape as
 * `useGroupData`'s balance query).
 *
 * `loadMore()` fetches one older, static page via `before_seq` set to the
 * oldest seq loaded so far, and prepends it. The *first* call also freezes
 * `boundarySeq` at that same seq (minus one) and switches the live query
 * from "latest `pageSize`" to "everything after `boundarySeq`" — without
 * this, a plain "latest N" window would silently drop the entry sitting
 * right at the load-more boundary once enough new entries arrived to push
 * it out of the newest-N window, leaving a gap between the static older
 * page and the live one that nothing would ever re-fetch. Freezing the
 * boundary the moment paging starts means the live side only ever grows
 * forward from it, never forgets it.
 *
 * Older pages don't themselves re-poll, so a correction landing on an
 * already-paged-past entry won't retroactively update until that page is
 * reloaded (accepted limitation, see PRD #221). Changing `pageSize` drops
 * any loaded older pages and the boundary, starting over at a fresh live
 * window of the new size.
 */
export function useGroupHistory(groupId: string, enabled: boolean) {
  const [pageSize, setPageSizeState] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [olderEntries, setOlderEntries] = useState<EntryRecord[]>([]);
  const [olderHasMore, setOlderHasMore] = useState<boolean | null>(null);
  const [boundarySeq, setBoundarySeq] = useState<number | null>(null);

  const windowQuery = useQuery<EntryList, ApiError>({
    queryKey:
      boundarySeq === null
        ? (["entries", groupId, "latest", pageSize] as const)
        : (["entries", groupId, "after", boundarySeq] as const),
    queryFn: () =>
      boundarySeq === null
        ? listEntries(groupId, undefined, undefined, pageSize)
        : listEntries(groupId, boundarySeq, undefined, LIVE_TAIL_LIMIT),
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const liveEntries = windowQuery.data?.entries ?? [];
  const entries = [...olderEntries, ...liveEntries];

  const loadMoreMutation = useMutation<EntryList, ApiError, number>({
    mutationFn: (oldestSeq) => listEntries(groupId, undefined, oldestSeq, pageSize),
    onSuccess: (page) => {
      setOlderEntries((prev) => [...page.entries, ...prev]);
      setOlderHasMore(page.has_more);
    },
  });

  function setPageSize(size: PageSize) {
    setPageSizeState(size);
    setOlderEntries([]);
    setOlderHasMore(null);
    setBoundarySeq(null);
  }

  function loadMore() {
    const oldestSeq = entries[0]?.seq;
    if (oldestSeq === undefined || loadMoreMutation.isPending) return;
    if (boundarySeq === null) setBoundarySeq(oldestSeq - 1);
    loadMoreMutation.mutate(oldestSeq);
  }

  // Once an older page has been loaded, its has_more supersedes the live
  // window's — the live window's own has_more only describes the boundary
  // right below it, which is no longer the edge of what's loaded.
  const hasMore = olderHasMore ?? windowQuery.data?.has_more ?? false;

  return {
    entries,
    pageSize,
    setPageSize,
    hasMore,
    loadMore,
    isLoadingMore: loadMoreMutation.isPending,
    error: windowQuery.error?.message ?? loadMoreMutation.error?.message ?? null,
  };
}
