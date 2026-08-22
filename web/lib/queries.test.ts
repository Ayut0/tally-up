import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { entriesKey, entriesOlderInfiniteQueryOptions, entriesWindowQueryOptions } from "./queries";

const G = "group-1";
const OTHER = "group-2";
const PAGE_SIZE = 20;
const BOUNDARY = 7;

/**
 * Seeds `client` with every entries query a paged history hook can hold at
 * once, and returns their keys. Data is irrelevant here — invalidation is
 * about which cache entries a key reaches, not what's in them.
 */
const EMPTY_PAGE = { entries: [], has_more: false };

function seedEntriesQueries(client: QueryClient, groupId: string) {
  const latest = entriesWindowQueryOptions(groupId, { boundarySeq: null, pageSize: PAGE_SIZE });
  const after = entriesWindowQueryOptions(groupId, { boundarySeq: BOUNDARY, pageSize: PAGE_SIZE });
  const older = entriesOlderInfiniteQueryOptions(groupId, {
    boundarySeq: BOUNDARY,
    pageSize: PAGE_SIZE,
  });

  // Seeded one at a time rather than over an array of keys: each key carries
  // its own data type, and the infinite query's is `InfiniteData`, not a page.
  client.setQueryData(latest.queryKey, EMPTY_PAGE);
  client.setQueryData(after.queryKey, EMPTY_PAGE);
  client.setQueryData(older.queryKey, { pages: [EMPTY_PAGE], pageParams: [BOUNDARY + 1] });

  return [latest.queryKey, after.queryKey, older.queryKey];
}

/**
 * Runs an options object's own `queryFn` against a stubbed `fetch` and
 * reports the URL it asked for — the only way to check that a key and the
 * request it labels actually describe the same window.
 */
async function requestedUrl(run: () => Promise<unknown>): Promise<URL> {
  // `url` is typed as string, not RequestInfo: every write in `lib/api` calls
  // fetch with a string, so this stays honest about what's actually observed.
  const fetchMock = vi.fn(
    async (_url: string) =>
      new Response(JSON.stringify(EMPTY_PAGE), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  await run();
  expect(fetchMock).toHaveBeenCalledOnce();
  return new URL(fetchMock.mock.calls[0][0]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("entriesKey", () => {
  // The invariant `useSettlePlan` leans on: recording a settlement invalidates
  // the single prefix `entriesKey(groupId)` and expects TanStack's own matcher
  // to reach every entries query the history hook may be holding — the live
  // window in either of its two forms, plus the paged-older infinite query.
  // Asserted through a real QueryClient rather than by slicing arrays, so it
  // fails if that matching behavior ever stops holding, not just if the key
  // literals drift.
  it("invalidates every entries query for its group", async () => {
    const client = new QueryClient();
    const keys = seedEntriesQueries(client, G);

    await client.invalidateQueries({ queryKey: entriesKey(G) });

    for (const key of keys) {
      expect(client.getQueryState(key)?.isInvalidated, `key ${JSON.stringify(key)}`).toBe(true);
    }
  });

  it("leaves another group's entries queries alone", async () => {
    const client = new QueryClient();
    seedEntriesQueries(client, G);
    const otherKeys = seedEntriesQueries(client, OTHER);

    await client.invalidateQueries({ queryKey: entriesKey(G) });

    for (const key of otherKeys) {
      expect(client.getQueryState(key)?.isInvalidated, `key ${JSON.stringify(key)}`).toBe(false);
    }
  });
});

// A key that says one thing while its queryFn fetches another poisons the
// cache entry silently — the window is the one place both switch on the
// same value, so these pin the two halves together.
describe("entriesWindowQueryOptions", () => {
  it("fetches the newest page when no boundary is frozen, and says so in its key", async () => {
    const options = entriesWindowQueryOptions(G, { boundarySeq: null, pageSize: PAGE_SIZE });

    const url = await requestedUrl(() => new QueryClient().fetchQuery(options));

    expect(url.searchParams.get("after_seq")).toBeNull();
    expect(url.searchParams.get("limit")).toBe(String(PAGE_SIZE));
    expect(options.queryKey).toContain("latest");
  });

  it("fetches everything past a frozen boundary, and says so in its key", async () => {
    const options = entriesWindowQueryOptions(G, { boundarySeq: 7, pageSize: PAGE_SIZE });

    const url = await requestedUrl(() => new QueryClient().fetchQuery(options));

    expect(url.searchParams.get("after_seq")).toBe("7");
    expect(options.queryKey).toContain("after");
    // Not pageSize: past the boundary the window has to hold every entry
    // recorded since, however many that is, up to the server's own ceiling.
    expect(url.searchParams.get("limit")).toBe("500");
  });
});

describe("entriesOlderInfiniteQueryOptions", () => {
  it("starts just below the frozen boundary and pages backwards", async () => {
    const options = entriesOlderInfiniteQueryOptions(G, { boundarySeq: 7, pageSize: PAGE_SIZE });

    const url = await requestedUrl(() => new QueryClient().fetchInfiniteQuery(options));

    expect(url.searchParams.get("before_seq")).toBe("8");
    expect(url.searchParams.get("limit")).toBe(String(PAGE_SIZE));
  });
});
