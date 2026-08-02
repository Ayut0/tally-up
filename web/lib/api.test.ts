import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zEntryAck } from "./api-schemas/zod.gen";
import { addEntry, createGroup, getBalance, getGroup, listEntries, postIdempotent } from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// RequestInit's `headers`/`body` are broad unions (HeadersInit/BodyInit); these
// narrow them without asserting, since a test's own fetch call always sends a
// string JSON body and plain headers.
function headerValue(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

function bodyText(init: RequestInit | undefined): string {
  if (typeof init?.body !== "string") throw new Error("expected a string request body");
  return init.body;
}

// zod.gen.ts validates Uuid as `format: uuid` (spec/main.tsp), stricter than
// the hand-written schema this replaces — response body fixtures need a
// real UUID shape, unlike request-only/path-param placeholders ("g1", "e1")
// which are never zod-parsed.
const ENTRY_ID = "018f4c9e-0000-7000-8000-000000000001";
const GROUP_ID = "018f4c9e-0000-7000-8000-000000000002";

describe("postIdempotent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends the Idempotency-Key header and returns the body on 201", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: ENTRY_ID, seq: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await postIdempotent(
      "/groups/g1/entries",
      { total_amount: 100 },
      "key-1",
      zEntryAck,
    );

    expect(result).toEqual({ id: ENTRY_ID, seq: 1 });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(headerValue(init, "Idempotency-Key")).toBe("key-1");
  });

  it("retries a network error with the SAME key and accepts a 200 replay", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network error"))
      .mockResolvedValueOnce(jsonResponse(200, { id: ENTRY_ID, seq: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = postIdempotent("/groups/g1/entries", { total_amount: 100 }, "key-1", zEntryAck);
    await vi.advanceTimersByTimeAsync(300);
    const result = await promise;

    expect(result).toEqual({ id: ENTRY_ID, seq: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const keys = fetchMock.mock.calls.map(([, init]) => headerValue(init, "Idempotency-Key"));
    expect(keys).toEqual(["key-1", "key-1"]);
  });

  it("waits and retries on 409 in-flight", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(409, { error: "in flight" }))
      .mockResolvedValueOnce(jsonResponse(201, { id: ENTRY_ID, seq: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = postIdempotent("/groups/g1/entries", { total_amount: 100 }, "key-1", zEntryAck);
    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;

    expect(result).toEqual({ id: ENTRY_ID, seq: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up on a sustained 409 in-flight instead of retrying forever", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(409, { error: "in flight" }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = postIdempotent("/groups/g1/entries", { total_amount: 100 }, "key-1", zEntryAck);
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("retries a 5xx with the SAME key and accepts a 201", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { error: "boom" }))
      .mockResolvedValueOnce(jsonResponse(201, { id: ENTRY_ID, seq: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = postIdempotent("/groups/g1/entries", { total_amount: 100 }, "key-1", zEntryAck);
    await vi.advanceTimersByTimeAsync(300);
    const result = await promise;

    expect(result).toEqual({ id: ENTRY_ID, seq: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const keys = fetchMock.mock.calls.map(([, init]) => headerValue(init, "Idempotency-Key"));
    expect(keys).toEqual(["key-1", "key-1"]);
  });

  it("gives up after 3 retries and surfaces an ApiError", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network error"));
    vi.stubGlobal("fetch", fetchMock);

    const promise = postIdempotent("/groups/g1/entries", { total_amount: 100 }, "key-1", zEntryAck);
    // Swallow the eventual rejection so it isn't reported as unhandled while
    // the fake-timer advances below are still pending.
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(900);
    await vi.advanceTimersByTimeAsync(2700);

    await expect(promise).rejects.toMatchObject({ status: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does NOT retry a 422 (client bug, not a flake)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(422, { error: "same key, different payload" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      postIdempotent("/groups/g1/entries", { total_amount: 100 }, "key-1", zEntryAck),
    ).rejects.toMatchObject({ status: 422 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("getGroup", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("GETs the group and returns the parsed body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { id: GROUP_ID, name: "Trip", members: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const group = await getGroup("g1");

    expect(group).toEqual({ id: GROUP_ID, name: "Trip", members: [] });
    expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:8080/groups/g1");
  });

  it("throws ApiError on a non-2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { error: "not found" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGroup("missing")).rejects.toMatchObject({ status: 404 });
  });

  it("throws ApiError when a 200 body fails contract validation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { id: "g1" /* missing name, members */ }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGroup("g1")).rejects.toMatchObject({ status: 200 });
  });
});

describe("getBalance / listEntries", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("getBalance GETs the group's balance snapshot", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { balances: [], as_of_seq: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    await getBalance("g1");

    expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:8080/groups/g1/balance");
  });

  it("listEntries GETs entries, passing after_seq as a query param when given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { entries: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await listEntries("g1", 42);

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://localhost:8080/groups/g1/entries?after_seq=42",
    );
  });

  it("listEntries omits after_seq when not given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { entries: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await listEntries("g1");

    expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:8080/groups/g1/entries");
  });
});

describe("createGroup / addEntry", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("createGroup POSTs to /groups with member_names and the idempotency key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { id: GROUP_ID, name: "Trip", members: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createGroup("g1", "Trip", ["Alice", "Bob"], "key-1");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:8080/groups");
    expect(JSON.parse(bodyText(init))).toEqual({
      id: "g1",
      name: "Trip",
      member_names: ["Alice", "Bob"],
    });
    expect(headerValue(init, "Idempotency-Key")).toBe("key-1");
  });

  it("addEntry POSTs the entry to /groups/{id}/entries with the idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: ENTRY_ID, seq: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const entry = {
      kind: "settlement" as const,
      id: "e1",
      requested_by: "p1",
      payer_id: "p1",
      counterparty: "p2",
      total_amount: 4000,
      occurred_on: "2026-07-05",
    };
    await addEntry("g1", entry, "key-2");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:8080/groups/g1/entries");
    expect(JSON.parse(bodyText(init))).toEqual(entry);
    expect(headerValue(init, "Idempotency-Key")).toBe("key-2");
  });
});
