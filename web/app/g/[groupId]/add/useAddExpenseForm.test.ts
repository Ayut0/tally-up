import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { components } from "@/lib/api-types";
import { useAddExpenseForm } from "./useAddExpenseForm";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

type GroupRecord = components["schemas"]["GroupRecord"];

const GROUP: GroupRecord = {
  id: "group-1",
  name: "Trip",
  members: [
    { id: "member-a", name: "Alice" },
    { id: "member-b", name: "Bob" },
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

describe("useAddExpenseForm", () => {
  it("starts with every member selected as a participant", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    expect(result.current.memberRows).toEqual([
      { id: "member-a", name: "Alice", checked: true },
      { id: "member-b", name: "Bob", checked: true },
    ]);
  });

  it("toggleParticipant removes then re-adds a member", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));

    act(() => result.current.toggleParticipant("member-a"));
    expect(result.current.memberRows.find((r) => r.id === "member-a")?.checked).toBe(false);

    act(() => result.current.toggleParticipant("member-a"));
    expect(result.current.memberRows.find((r) => r.id === "member-a")?.checked).toBe(true);
  });

  it("submitDisabled starts true with no total entered, and clears once a valid total is set", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    expect(result.current.submitDisabled).toBe(true);

    act(() => result.current.setTotalInput("1000"));
    expect(result.current.submitDisabled).toBe(false);
  });

  it("submitDisabled is true again once every participant is deselected", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.setTotalInput("1000"));

    act(() => result.current.toggleParticipant("member-a"));
    act(() => result.current.toggleParticipant("member-b"));
    expect(result.current.submitDisabled).toBe(true);
  });

  it("defaults to the equal split tab active, with exact/weight sections hidden", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    expect(result.current.splitTabs).toEqual([
      { mode: "equal", label: "Equal", active: true },
      { mode: "exact", label: "Exact", active: false },
      { mode: "shares", label: "Shares", active: false },
      { mode: "percent", label: "Percent", active: false },
    ]);
    expect(result.current.showExactInputs).toBe(false);
    expect(result.current.showWeightInputs).toBe(false);
  });

  it("switching to exact mode shows exact rows and marks the exact tab active", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.setMode("exact"));

    expect(result.current.showExactInputs).toBe(true);
    expect(result.current.splitTabs.find((t) => t.mode === "exact")?.active).toBe(true);
    expect(result.current.exactRows).toEqual([
      { id: "member-a", name: "Alice", amount: "" },
      { id: "member-b", name: "Bob", amount: "" },
    ]);
  });

  it("setAmount fills in an exact row's amount", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.setMode("exact"));
    act(() => result.current.setAmount("member-a", 700));

    expect(result.current.exactRows.find((r) => r.id === "member-a")?.amount).toBe(700);
  });

  it("a de-selected participant's amount survives and resurfaces on re-select", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.setMode("exact"));
    act(() => result.current.setAmount("member-a", 700));

    act(() => result.current.toggleParticipant("member-a"));
    expect(result.current.exactRows.find((r) => r.id === "member-a")).toBeUndefined();

    act(() => result.current.toggleParticipant("member-a"));
    expect(result.current.exactRows.find((r) => r.id === "member-a")?.amount).toBe(700);
  });

  it("switching to shares mode shows weight rows and marks the shares tab active", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.setMode("shares"));

    expect(result.current.showWeightInputs).toBe(true);
    expect(result.current.splitTabs.find((t) => t.mode === "shares")?.active).toBe(true);
    expect(result.current.weightRows).toEqual([
      { id: "member-a", name: "Alice", weight: "" },
      { id: "member-b", name: "Bob", weight: "" },
    ]);
  });

  it("setWeight fills in a weight row's value", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.setMode("shares"));
    act(() => result.current.setWeight("member-a", 2));

    expect(result.current.weightRows.find((r) => r.id === "member-a")?.weight).toBe(2);
  });

  it("surfaces the split validation error and no preview when exact amounts don't sum to the total", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.setTotalInput("1000"));
    act(() => result.current.setMode("exact"));
    act(() => result.current.setAmount("member-a", 100));
    act(() => result.current.setAmount("member-b", 200));

    expect(result.current.ruleError).toMatch(/amounts sum/);
    expect(result.current.previewRows).toBeNull();
  });

  it("does not crash computing a preview once every participant is deselected", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.setTotalInput("1000"));

    act(() => result.current.toggleParticipant("member-a"));
    act(() => result.current.toggleParticipant("member-b"));

    expect(result.current.previewRows).toBeNull();
  });

  it("shows formatted preview rows once the split is valid", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.setTotalInput("1000"));

    expect(result.current.ruleError).toBeNull();
    expect(result.current.previewRows).toEqual([
      { id: "member-a", name: "Alice", formattedShare: "¥500" },
      { id: "member-b", name: "Bob", formattedShare: "¥500" },
    ]);
  });

  it("reuses the same id and idempotency key when retrying an unchanged submission", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(422, { error: "rejected" })));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.setTotalInput("1000"));

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

    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.setTotalInput("1000"));
    await act(() => result.current.handleSubmit(submitEvent()));
    await waitFor(() => expect(result.current.submitting).toBe(false));

    act(() => result.current.setTotalInput("2000"));
    await act(() => result.current.handleSubmit(submitEvent()));
    await waitFor(() => expect(result.current.submitting).toBe(false));

    const [, firstInit] = fetchMock.mock.calls[0]!;
    const [, secondInit] = fetchMock.mock.calls[1]!;
    const firstKey = new Headers(firstInit.headers).get("Idempotency-Key");
    const secondKey = new Headers(secondInit.headers).get("Idempotency-Key");
    expect(secondKey).not.toBe(firstKey);
    expect(JSON.parse(secondInit.body).id).not.toBe(JSON.parse(firstInit.body).id);
  });

  it("navigates to the group page once the submission succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: ENTRY_ID, seq: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.setTotalInput("1000"));
    await act(() => result.current.handleSubmit(submitEvent()));

    expect(pushMock).toHaveBeenCalledWith("/g/group-1");
  });

  it("surfaces the server's error message and clears submitting on failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(422, { error: "duplicate payload" }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.setTotalInput("1000"));
    await act(() => result.current.handleSubmit(submitEvent()));

    expect(result.current.submitError).toBe("duplicate payload");
    expect(result.current.submitting).toBe(false);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
