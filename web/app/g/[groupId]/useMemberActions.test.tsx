import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRemoveMember } from "./useMemberActions";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** `removeMember` only checks `res.ok` on success, so a bodiless 204 matches the real server. */
function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRemoveMember", () => {
  it("starts closed with no member confirming", () => {
    const { result } = renderHook(() => useRemoveMember("group-1"), { wrapper });
    expect(result.current.confirmingId).toBeNull();
    expect(result.current.modalProps.isOpen).toBe(false);
  });

  it("requestRemove opens the modal for that member", () => {
    const { result } = renderHook(() => useRemoveMember("group-1"), { wrapper });
    act(() => result.current.requestRemove("member-a"));
    expect(result.current.confirmingId).toBe("member-a");
    expect(result.current.modalProps.isOpen).toBe(true);
  });

  it("cancelRemove closes the modal and clears confirmingId", () => {
    const { result } = renderHook(() => useRemoveMember("group-1"), { wrapper });
    act(() => result.current.requestRemove("member-a"));
    act(() => result.current.cancelRemove());
    expect(result.current.confirmingId).toBeNull();
    expect(result.current.modalProps.isOpen).toBe(false);
  });

  it("modalProps.onOpenChange(false) behaves like cancelRemove", () => {
    const { result } = renderHook(() => useRemoveMember("group-1"), { wrapper });
    act(() => result.current.requestRemove("member-a"));
    act(() => result.current.modalProps.onOpenChange(false));
    expect(result.current.confirmingId).toBeNull();
  });

  it("confirmRemove success clears confirmingId and leaves no error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(noContentResponse());
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRemoveMember("group-1"), { wrapper });
    act(() => result.current.requestRemove("member-a"));
    await act(() => result.current.confirmRemove("member-a"));

    await waitFor(() => expect(result.current.confirmingId).toBeNull());
    expect(result.current.modalProps.isOpen).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("confirmRemove 409 failure keeps confirmingId set and renders the error, modal still open", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(409, { error: "member has a nonzero balance" }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRemoveMember("group-1"), { wrapper });
    act(() => result.current.requestRemove("member-a"));
    await act(() => result.current.confirmRemove("member-a"));

    await waitFor(() => expect(result.current.error).toBe("member has a nonzero balance"));
    expect(result.current.confirmingId).toBe("member-a");
    expect(result.current.modalProps.isOpen).toBe(true);
  });

  it("blocks dismissal while the confirming row's removal is in flight", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRemoveMember("group-1"), { wrapper });
    act(() => result.current.requestRemove("member-a"));
    act(() => {
      result.current.confirmRemove("member-a");
    });

    await waitFor(() => expect(result.current.isRemoving("member-a")).toBe(true));
    expect(result.current.modalProps.isDismissable).toBe(false);
    expect(result.current.modalProps.isKeyboardDismissDisabled).toBe(true);

    // cancelRemove/requestRemove are no-ops while this row's removal is pending.
    act(() => result.current.cancelRemove());
    expect(result.current.confirmingId).toBe("member-a");
    act(() => result.current.requestRemove("member-b"));
    expect(result.current.confirmingId).toBe("member-a");

    resolveFetch(noContentResponse());
    await waitFor(() => expect(result.current.isRemoving("member-a")).toBe(false));
  });

  it("dismissal is allowed once no removal is in flight", () => {
    const { result } = renderHook(() => useRemoveMember("group-1"), { wrapper });
    act(() => result.current.requestRemove("member-a"));
    expect(result.current.modalProps.isDismissable).toBe(true);
    expect(result.current.modalProps.isKeyboardDismissDisabled).toBe(false);
  });
});
