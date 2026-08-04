import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { components } from "@/lib/api-types";
import { useRecordPaymentForm } from "./useRecordPaymentForm";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

type GroupRecord = components["schemas"]["GroupRecord"];
type BalanceSnapshot = components["schemas"]["BalanceSnapshot"];

const GROUP: GroupRecord = {
  id: "group-1",
  name: "Trip",
  members: [
    { id: "member-a", name: "Alice" },
    { id: "member-b", name: "Bob" },
    { id: "member-c", name: "Carol" },
  ],
};

const BALANCE: BalanceSnapshot = {
  as_of_seq: 1,
  balances: [
    { member_id: "member-a", balance: -3000 },
    { member_id: "member-b", balance: 1000 },
    { member_id: "member-c", balance: 2000 },
  ],
};

const ENTRY_ID = "018f4c9e-0000-7000-8000-000000000001";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function submitEvent(): React.FormEvent {
  return { preventDefault: () => {} } as React.FormEvent;
}

afterEach(() => {
  vi.unstubAllGlobals();
  pushMock.mockClear();
});

describe("useRecordPaymentForm", () => {
  it("defaults payer to member-a and counterparty to the top creditor, excluding the payer", () => {
    const { result } = renderHook(() => useRecordPaymentForm("group-1", GROUP, BALANCE, {}));
    expect(result.current.payerId).toBe("member-a");
    expect(result.current.counterpartyId).toBe("member-c");
  });

  it("lists counterparty rows creditors-first, excluding the current payer", () => {
    const { result } = renderHook(() => useRecordPaymentForm("group-1", GROUP, BALANCE, {}));
    expect(result.current.counterpartyRows.map((r) => r.id)).toEqual(["member-c", "member-b"]);
  });

  it("falls back to member order when no other member has a positive balance", () => {
    const allSettled: BalanceSnapshot = {
      as_of_seq: 1,
      balances: [
        { member_id: "member-a", balance: 0 },
        { member_id: "member-b", balance: 0 },
        { member_id: "member-c", balance: 0 },
      ],
    };
    const { result } = renderHook(() => useRecordPaymentForm("group-1", GROUP, allSettled, {}));
    expect(result.current.counterpartyRows.map((r) => r.id)).toEqual(["member-b", "member-c"]);
  });

  it("seeds payer/counterparty from initial deep-link ids when given", () => {
    const { result } = renderHook(() =>
      useRecordPaymentForm("group-1", GROUP, BALANCE, {
        initialPayerId: "member-b",
        initialCounterpartyId: "member-c",
      }),
    );
    expect(result.current.payerId).toBe("member-b");
    expect(result.current.counterpartyId).toBe("member-c");
  });

  it("re-picks a valid counterparty when the payer changes onto the current counterparty", () => {
    const { result } = renderHook(() => useRecordPaymentForm("group-1", GROUP, BALANCE, {}));
    expect(result.current.counterpartyId).toBe("member-c");

    act(() => result.current.setPayerId("member-c"));
    expect(result.current.payerId).toBe("member-c");
    expect(result.current.counterpartyId).not.toBe("member-c");
  });

  it("submitDisabled starts true with no amount entered, and clears once a valid amount is set", () => {
    const { result } = renderHook(() => useRecordPaymentForm("group-1", GROUP, BALANCE, {}));
    expect(result.current.submitDisabled).toBe(true);

    act(() => result.current.setAmountInput("1000"));
    expect(result.current.submitDisabled).toBe(false);
  });

  it("amount field starts empty with no prefill", () => {
    const { result } = renderHook(() => useRecordPaymentForm("group-1", GROUP, BALANCE, {}));
    expect(result.current.amountInput).toBe("");
  });

  it("reuses the same id and idempotency key when retrying an unchanged submission", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(422, { error: "rejected" })));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRecordPaymentForm("group-1", GROUP, BALANCE, {}));
    act(() => result.current.setAmountInput("1000"));

    await act(() => result.current.handleSubmit(submitEvent()));
    await waitFor(() => expect(result.current.submitting).toBe(false));
    await act(() => result.current.handleSubmit(submitEvent()));
    await waitFor(() => expect(result.current.submitting).toBe(false));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, firstInit] = fetchMock.mock.calls[0]!;
    const [, secondInit] = fetchMock.mock.calls[1]!;
    const firstKey = new Headers(firstInit.headers).get("Idempotency-Key");
    const secondKey = new Headers(secondInit.headers).get("Idempotency-Key");
    expect(secondKey).toBe(firstKey);
    expect(JSON.parse(secondInit.body).id).toBe(JSON.parse(firstInit.body).id);
  });

  it("mints a new id and idempotency key once the submission changes", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(422, { error: "rejected" })));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRecordPaymentForm("group-1", GROUP, BALANCE, {}));
    act(() => result.current.setAmountInput("1000"));
    await act(() => result.current.handleSubmit(submitEvent()));
    await waitFor(() => expect(result.current.submitting).toBe(false));

    act(() => result.current.setAmountInput("2000"));
    await act(() => result.current.handleSubmit(submitEvent()));
    await waitFor(() => expect(result.current.submitting).toBe(false));

    const [, firstInit] = fetchMock.mock.calls[0]!;
    const [, secondInit] = fetchMock.mock.calls[1]!;
    const firstKey = new Headers(firstInit.headers).get("Idempotency-Key");
    const secondKey = new Headers(secondInit.headers).get("Idempotency-Key");
    expect(secondKey).not.toBe(firstKey);
    expect(JSON.parse(secondInit.body).id).not.toBe(JSON.parse(firstInit.body).id);
  });

  it("posts a settlement with payer_id/counterparty and navigates home on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: ENTRY_ID, seq: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRecordPaymentForm("group-1", GROUP, BALANCE, {}));
    act(() => result.current.setAmountInput("1500"));
    await act(() => result.current.handleSubmit(submitEvent()));

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      kind: "settlement",
      payer_id: "member-a",
      counterparty: "member-c",
      total_amount: 1500,
    });
    expect(pushMock).toHaveBeenCalledWith("/g/group-1");
  });

  it("surfaces the server's error message and clears submitting on failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(422, { error: "duplicate payload" }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRecordPaymentForm("group-1", GROUP, BALANCE, {}));
    act(() => result.current.setAmountInput("1000"));
    await act(() => result.current.handleSubmit(submitEvent()));

    expect(result.current.submitError).toBe("duplicate payload");
    expect(result.current.submitting).toBe(false);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
