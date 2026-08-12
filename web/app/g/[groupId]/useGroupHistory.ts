"use client";

import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ApiError, listEntries } from "@/lib/api";
import type { components } from "@/lib/api-types";
import { POLL_INTERVAL_MS } from "./useGroupData";

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
 * `loadMore()` fetches older, static pages via TanStack Query's own
 * `useInfiniteQuery` (`olderQuery` below) — its `data.pages`/`hasNextPage`
 * replace what an earlier version of this hook tracked by hand in
 * `useState`. The *first* call also freezes `boundarySeq` at the live
 * window's oldest seq (minus one) and switches the live query from "latest
 * `pageSize`" to "everything after `boundarySeq`" — without this, a plain
 * "latest N" window would silently drop the entry sitting right at the
 * load-more boundary once enough new entries arrived to push it out of the
 * newest-N window, leaving a gap between the older pages and the live one
 * that nothing would ever re-fetch. Freezing the boundary the moment
 * paging starts means the live side only ever grows forward from it, never
 * forgets it.
 *
 * `boundarySeq` itself can't be a TanStack-managed value: it's a snapshot
 * of "where the live window's oldest entry was *the moment the user first
 * paged back*", not something re-derivable from current query data (the
 * live window keeps moving after that). `pageSize` is plain user-selection
 * state with no server counterpart at all. Both stay as local `useState`;
 * everything that *is* fetched, paged server data now lives in
 * `olderQuery`/`windowQuery`'s own caches instead.
 *
 * Older pages don't themselves re-poll, so a correction landing on an
 * already-paged-past entry won't retroactively update until that page is
 * reloaded (accepted limitation, see PRD #221). Changing `pageSize` drops
 * any loaded older pages and the boundary, starting over at a fresh live
 * window of the new size.
 */
export function useGroupHistory(groupId: string, enabled: boolean) {
  const [pageSize, setPageSizeState] = useState<PageSize>(DEFAULT_PAGE_SIZE);
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

  const olderQuery = useInfiniteQuery({
    queryKey: ["entries", groupId, "older", boundarySeq] as const,
    queryFn: ({ pageParam }) => listEntries(groupId, undefined, pageParam, pageSize),
    initialPageParam: (boundarySeq ?? 0) + 1,
    getNextPageParam: (lastPage: EntryList) =>
      lastPage.has_more ? lastPage.entries[0]?.seq : undefined,
    enabled: enabled && boundarySeq !== null,
  });

  const olderEntries = olderQuery.data?.pages.flatMap((page) => page.entries) ?? [];
  const liveEntries = windowQuery.data?.entries ?? [];
  const entries = [...olderEntries, ...liveEntries];

  function setPageSize(size: PageSize) {
    setPageSizeState(size);
    setBoundarySeq(null);
  }

  function loadMore() {
    if (olderQuery.isFetching) return;
    if (boundarySeq === null) {
      const oldestSeq = entries[0]?.seq;
      if (oldestSeq === undefined) return;
      setBoundarySeq(oldestSeq - 1);
      return; // enabling olderQuery triggers its own initial fetch
    }
    void olderQuery.fetchNextPage();
  }

  // Before any older page is loaded, hasMore describes the live window's
  // own boundary. Once paging has started, olderQuery.hasNextPage — derived
  // from the last older page's own has_more — takes over: the live
  // window's has_more only ever describes the edge right below itself,
  // which is no longer where the loaded history actually ends.
  const hasMore =
    boundarySeq === null ? (windowQuery.data?.has_more ?? false) : !!olderQuery.hasNextPage;

  return {
    entries,
    pageSize,
    setPageSize,
    hasMore,
    loadMore,
    isLoadingMore: olderQuery.isFetching,
    error: windowQuery.error?.message ?? olderQuery.error?.message ?? null,
  };
}
