import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGroupHistory } from "./useGroupHistory";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PAYER_ID = crypto.randomUUID();

function entry(seq: number) {
  return {
    id: crypto.randomUUID(),
    seq,
    kind: "expense",
    payer_id: PAYER_ID,
    total_amount: 100,
    participants: [PAYER_ID],
    occurred_on: "2026-08-01",
    created_by: PAYER_ID,
    created_at: "2026-08-01T00:00:00Z",
    postings: [],
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

afterEach(() => vi.unstubAllGlobals());

describe("useGroupHistory", () => {
  it("fetches the latest `pageSize` entries on mount, defaulting to 20", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { entries: [entry(1), entry(2)], has_more: true }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useGroupHistory("g1", true), { wrapper });

    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(result.current.pageSize).toBe(20);
    expect(result.current.hasMore).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:8080/groups/g1/entries?limit=20");
  });

  it("loadMore fetches an older page via before_seq and prepends it, updating hasMore from that page", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("before_seq")) {
        return Promise.resolve(jsonResponse(200, { entries: [entry(1)], has_more: false }));
      }
      return Promise.resolve(jsonResponse(200, { entries: [entry(2), entry(3)], has_more: true }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useGroupHistory("g1", true), { wrapper });
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(result.current.hasMore).toBe(true);

    await act(async () => result.current.loadMore());

    await waitFor(() => expect(result.current.entries).toHaveLength(3));
    expect(result.current.entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(result.current.hasMore).toBe(false);
    const beforeSeqCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes("before_seq"),
    );
    expect(beforeSeqCall?.[0]).toBe(
      "http://localhost:8080/groups/g1/entries?before_seq=2&limit=20",
    );
  });

  it("setPageSize resets any loaded older pages and re-fetches at the new size", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("before_seq")) {
        return Promise.resolve(jsonResponse(200, { entries: [entry(1)], has_more: false }));
      }
      if (url.includes("limit=10")) {
        return Promise.resolve(jsonResponse(200, { entries: [entry(3)], has_more: false }));
      }
      return Promise.resolve(jsonResponse(200, { entries: [entry(2), entry(3)], has_more: true }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useGroupHistory("g1", true), { wrapper });
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    await act(async () => result.current.loadMore());
    await waitFor(() => expect(result.current.entries).toHaveLength(3));

    act(() => result.current.setPageSize(10));

    await waitFor(() => expect(result.current.pageSize).toBe(10));
    await waitFor(() => expect(result.current.entries.map((e) => e.seq)).toEqual([3]));
  });

  // Regression coverage for #221: a live window that always re-queries
  // "latest pageSize" would drop the entry sitting at the load-more
  // boundary once enough new entries pushed it out of that window — a gap
  // between the static older page and the live one that nothing would ever
  // re-fetch. loadMore() must freeze a boundary and switch the live query
  // to "everything after it" so this can't happen.
  it("loadMore freezes a boundary so a later poll can't drop the entry at the seam, even once new entries push past pageSize", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("before_seq")) {
        return Promise.resolve(jsonResponse(200, { entries: [entry(1)], has_more: false }));
      }
      if (url.includes("after_seq=1")) {
        // Everything since the frozen boundary, including a new entry (4)
        // that arrived after paging started — seq 2 must still be present.
        return Promise.resolve(
          jsonResponse(200, { entries: [entry(2), entry(3), entry(4)], has_more: false }),
        );
      }
      // Initial "latest pageSize" fetch, before any boundary exists.
      return Promise.resolve(jsonResponse(200, { entries: [entry(2), entry(3)], has_more: true }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useGroupHistory("g1", true), { wrapper });
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    await act(async () => result.current.loadMore());

    // Once the boundary-tracking query lands, seq 2 stays put even though
    // it's no longer among the "latest 2" — the gap the old design allowed.
    await waitFor(() => expect(result.current.entries.map((e) => e.seq)).toEqual([1, 2, 3, 4]));
  });
});
