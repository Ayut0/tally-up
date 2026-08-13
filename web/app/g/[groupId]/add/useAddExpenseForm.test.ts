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
    expect(result.current.showSharesInputs).toBe(false);
    expect(result.current.showPercentInputs).toBe(false);
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

  it("switching to shares mode defaults every row to 1 share and marks the shares tab active", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.setMode("shares"));

    expect(result.current.showSharesInputs).toBe(true);
    expect(result.current.splitTabs.find((t) => t.mode === "shares")?.active).toBe(true);
    expect(result.current.sharesRows.map(({ id, name, weight }) => ({ id, name, weight }))).toEqual(
      [
        { id: "member-a", name: "Alice", weight: 1 },
        { id: "member-b", name: "Bob", weight: 1 },
      ],
    );
  });

  it("incrementWeight/decrementWeight adjust a shares row, clamped at a minimum of 1", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.setMode("shares"));

    act(() => result.current.incrementWeight("member-a"));
    expect(result.current.sharesRows.find((r) => r.id === "member-a")?.weight).toBe(2);

    act(() => result.current.decrementWeight("member-a"));
    act(() => result.current.decrementWeight("member-a"));
    expect(result.current.sharesRows.find((r) => r.id === "member-a")?.weight).toBe(1);
  });

  it("two increments in the same tick both land, rather than one clobbering the other", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.setMode("shares"));

    act(() => {
      result.current.incrementWeight("member-a");
      result.current.incrementWeight("member-a");
    });

    expect(result.current.sharesRows.find((r) => r.id === "member-a")?.weight).toBe(3);
  });

  it("switching to percent mode shows every member, with a deselected one rendered inactive", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.toggleParticipant("member-b"));
    act(() => result.current.setMode("percent"));

    expect(result.current.showPercentInputs).toBe(true);
    expect(result.current.percentRows).toEqual([
      { id: "member-a", name: "Alice", active: true, percent: "", formattedShare: "¥0" },
      { id: "member-b", name: "Bob", active: false },
    ]);
  });

  it("computes a live formatted share for percent rows from typed percentages", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.setTotalInput("1000"));
    act(() => result.current.setMode("percent"));
    act(() => result.current.setWeight("member-a", 70));
    act(() => result.current.setWeight("member-b", 30));

    expect(result.current.percentRows).toEqual([
      { id: "member-a", name: "Alice", active: true, percent: 70, formattedShare: "¥700" },
      { id: "member-b", name: "Bob", active: true, percent: 30, formattedShare: "¥300" },
    ]);
  });

  it("exactSummary is null until a valid total is entered, then reflects the running sum", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.setMode("exact"));
    expect(result.current.exactSummary).toBeNull();

    act(() => result.current.setTotalInput("1000"));
    act(() => result.current.setAmount("member-a", 400));
    expect(result.current.exactSummary).toEqual({
      enteredFormatted: "¥400",
      targetFormatted: "¥1,000",
      matches: false,
    });

    act(() => result.current.setAmount("member-b", 600));
    expect(result.current.exactSummary).toEqual({
      enteredFormatted: "¥1,000",
      targetFormatted: "¥1,000",
      matches: true,
    });
  });

  it("sharesSummary counts total shares and confirms the yen total once a valid total is set", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.setMode("shares"));
    expect(result.current.sharesSummary).toBeNull();

    act(() => result.current.setTotalInput("1000"));
    act(() => result.current.incrementWeight("member-a"));
    expect(result.current.sharesSummary).toEqual({ count: 3, totalFormatted: "¥1,000" });
  });

  it("percentSummary reflects the entered percent total and flips complete at 100", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.setMode("percent"));
    act(() => result.current.setTotalInput("1000"));

    act(() => result.current.setWeight("member-a", 60));
    expect(result.current.percentSummary).toEqual({
      percentTotal: 60,
      totalFormatted: "¥1,000",
      complete: false,
    });

    act(() => result.current.setWeight("member-b", 40));
    expect(result.current.percentSummary).toEqual({
      percentTotal: 100,
      totalFormatted: "¥1,000",
      complete: true,
    });
  });

  it("every summary goes null once every participant is deselected, even with a valid total", () => {
    const { result } = renderHook(() => useAddExpenseForm("group-1", GROUP));
    act(() => result.current.setTotalInput("1000"));

    act(() => result.current.toggleParticipant("member-a"));
    act(() => result.current.toggleParticipant("member-b"));

    expect(result.current.exactSummary).toBeNull();
    expect(result.current.sharesSummary).toBeNull();
    expect(result.current.percentSummary).toBeNull();
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
