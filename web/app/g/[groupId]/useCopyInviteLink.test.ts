import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopyInviteLink } from "./useCopyInviteLink";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useCopyInviteLink", () => {
  it("starts uncopied", () => {
    const { result } = renderHook(() => useCopyInviteLink());
    expect(result.current.copied).toBe(false);
  });

  it("writes the current URL to the clipboard and flips copied to true", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const { result } = renderHook(() => useCopyInviteLink());
    await act(async () => {
      await result.current.copy();
    });

    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(result.current.copied).toBe(true);
  });

  it("resets copied back to false after the confirmation window", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });

    const { result } = renderHook(() => useCopyInviteLink());
    await act(async () => {
      await result.current.copy();
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(result.current.copied).toBe(false);
  });
});
