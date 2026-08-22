"use client";

import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { entriesOlderInfiniteQueryOptions, entriesWindowQueryOptions } from "@/lib/queries";
import { POLL_INTERVAL_MS } from "./useGroupData";

export const PAGE_SIZES = [10, 20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
const DEFAULT_PAGE_SIZE: PageSize = 20;

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
 * forgets it. That switch — key and request together — lives in
 * `entriesWindowQueryOptions`, so the two halves cannot drift apart.
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

  const windowQuery = useQuery({
    ...entriesWindowQueryOptions(groupId, { boundarySeq, pageSize }),
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const olderQuery = useInfiniteQuery({
    ...entriesOlderInfiniteQueryOptions(groupId, { boundarySeq, pageSize }),
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
