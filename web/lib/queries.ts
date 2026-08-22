/**
 * The cache layer's vocabulary: a `queryOptions()` factory per server
 * resource, pairing a query key with the `lib/api` call that fills it, plus
 * `entriesKey` for the one prefix invalidation addresses directly.
 *
 * Hooks under `app/` spread these and add their own per-call-site knobs —
 * `enabled`, `refetchInterval` — which deliberately differ between call
 * sites (the group page polls balance; the record-payment page reads it
 * once). Keeping keys here rather than inline at each `useQuery` means the
 * prefix relationships that invalidation depends on are stated in one
 * place instead of being re-derived, correctly or otherwise, per hook.
 *
 * Error types are left to `queryOptions`' default (`Error`) rather than
 * pinned to `ApiError`: every rejection here does come from `lib/api` and
 * so is an `ApiError`, but no consumer reads anything beyond `.message`,
 * and naming the type explicitly would force `QueryKey` to widen off the
 * key literals.
 */
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { getBalance, getGroup, getPairwiseBalances, getSettlePlan, listEntries } from "./api";
import type { components } from "./api-types";

type EntryList = components["schemas"]["EntryList"];

// Ceiling for the "everything since the paging boundary" live query — the
// backend clamps limit to this anyway (maxListLimit in reads.go), so this
// just makes the ceiling explicit instead of relying on the server's
// default (100).
const LIVE_TAIL_LIMIT = 500;

/** How the history hook's live window is scoped: newest `pageSize`, or everything after a frozen boundary. */
type EntriesWindow = { boundarySeq: number | null; pageSize: number };

/** The group and its members. Every group-scoped page reads this first. */
export function groupQueryOptions(groupId: string) {
  return queryOptions({
    queryKey: ["group", groupId] as const,
    queryFn: () => getGroup(groupId),
  });
}

/** Net position per member. */
export function balanceQueryOptions(groupId: string) {
  return queryOptions({
    queryKey: ["balance", groupId] as const,
    queryFn: () => getBalance(groupId),
  });
}

/** Who owes whom, pair by pair. */
export function pairwiseBalancesQueryOptions(groupId: string) {
  return queryOptions({
    queryKey: ["pairwise-balances", groupId] as const,
    queryFn: () => getPairwiseBalances(groupId),
  });
}

/** The minimal set of transfers that settles the group. */
export function settlePlanQueryOptions(groupId: string) {
  return queryOptions({
    queryKey: ["settle-plan", groupId] as const,
    queryFn: () => getSettlePlan(groupId),
  });
}

/**
 * The prefix every entries query shares. Invalidating this reaches all of
 * them for `groupId` — see `queries.test.ts`, which pins that behavior.
 */
export function entriesKey(groupId: string) {
  return ["entries", groupId] as const;
}

/**
 * The history hook's live window.
 *
 * Key and `queryFn` both switch on `boundarySeq`, and they have to agree —
 * a key saying `"latest"` over data fetched with `after_seq` would poison
 * the cache entry. Branching in one place here is what makes that
 * impossible to get wrong at a call site.
 */
export function entriesWindowQueryOptions(
  groupId: string,
  { boundarySeq, pageSize }: EntriesWindow,
) {
  // Built as one options object rather than a ternary over two `queryOptions`
  // calls: the latter returns a union type, which every consumer then has to
  // discriminate for no benefit — they only ever pass it straight to useQuery.
  const queryKey =
    boundarySeq === null
      ? ([...entriesKey(groupId), "latest", pageSize] as const)
      : ([...entriesKey(groupId), "after", boundarySeq] as const);

  return queryOptions({
    queryKey,
    queryFn: (): Promise<EntryList> =>
      boundarySeq === null
        ? listEntries(groupId, undefined, undefined, pageSize)
        : listEntries(groupId, boundarySeq, undefined, LIVE_TAIL_LIMIT),
  });
}

/**
 * Older, static pages below the frozen boundary. Paged by `before_seq`,
 * walking backwards from the oldest entry of the previous page.
 */
export function entriesOlderInfiniteQueryOptions(
  groupId: string,
  { boundarySeq, pageSize }: EntriesWindow,
) {
  return infiniteQueryOptions({
    queryKey: [...entriesKey(groupId), "older", boundarySeq] as const,
    queryFn: ({ pageParam }): Promise<EntryList> =>
      listEntries(groupId, undefined, pageParam, pageSize),
    initialPageParam: (boundarySeq ?? 0) + 1,
    getNextPageParam: (lastPage: EntryList) =>
      lastPage.has_more ? lastPage.entries[0]?.seq : undefined,
  });
}
