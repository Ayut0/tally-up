import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBalancePulse } from "./useBalancePulse";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useBalancePulse", () => {
  it("pulses nothing on first render", () => {
    const { result } = renderHook(() => useBalancePulse([{ member_id: "m1", balance: 500 }]));
    expect(result.current).toEqual(new Set());
  });

  it("pulses a member whose balance changed on a later poll", () => {
    const { result, rerender } = renderHook(({ balances }) => useBalancePulse(balances), {
      initialProps: {
        balances: [
          { member_id: "m1", balance: 500 },
          { member_id: "m2", balance: -500 },
        ],
      },
    });

    rerender({
      balances: [
        { member_id: "m1", balance: 500 },
        { member_id: "m2", balance: -800 },
      ],
    });

    expect(result.current).toEqual(new Set(["m2"]));
  });

  it("clears the pulse after the animation window", () => {
    const { result, rerender } = renderHook(({ balances }) => useBalancePulse(balances), {
      initialProps: { balances: [{ member_id: "m1", balance: 500 }] },
    });

    rerender({ balances: [{ member_id: "m1", balance: 800 }] });
    expect(result.current).toEqual(new Set(["m1"]));

    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(result.current).toEqual(new Set());
  });

  it("does not pulse when a poll tick brings no change", () => {
    const initialBalances = [{ member_id: "m1", balance: 500 }];
    const { result, rerender } = renderHook(({ balances }) => useBalancePulse(balances), {
      initialProps: { balances: initialBalances },
    });

    rerender({ balances: [{ member_id: "m1", balance: 500 }] });
    expect(result.current).toEqual(new Set());
  });

  it("tracks independent timers so one member's pulse clearing doesn't clear another's", () => {
    const { result, rerender } = renderHook(({ balances }) => useBalancePulse(balances), {
      initialProps: {
        balances: [
          { member_id: "m1", balance: 500 },
          { member_id: "m2", balance: -500 },
        ],
      },
    });

    rerender({
      balances: [
        { member_id: "m1", balance: 900 },
        { member_id: "m2", balance: -500 },
      ],
    });
    expect(result.current).toEqual(new Set(["m1"]));

    act(() => {
      vi.advanceTimersByTime(800);
    });
    rerender({
      balances: [
        { member_id: "m1", balance: 900 },
        { member_id: "m2", balance: -900 },
      ],
    });
    expect(result.current).toEqual(new Set(["m1", "m2"]));

    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(result.current).toEqual(new Set(["m2"]));

    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(result.current).toEqual(new Set());
  });
});
