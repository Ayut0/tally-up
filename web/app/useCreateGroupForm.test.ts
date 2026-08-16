import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCreateGroupForm } from "./useCreateGroupForm";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

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

describe("useCreateGroupForm", () => {
  it("reuses the same group id and idempotency key when retrying an unchanged submission", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(422, { error: "rejected" })));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCreateGroupForm());
    act(() => result.current.setGroupName("Kyoto trip"));
    act(() => result.current.updateMemberName(0, "Alice"));

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

  it("mints a new group id and idempotency key once the submission changes", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(422, { error: "rejected" })));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCreateGroupForm());
    act(() => result.current.setGroupName("Kyoto trip"));
    act(() => result.current.updateMemberName(0, "Alice"));
    await act(() => result.current.handleSubmit(submitEvent()));
    await waitFor(() => expect(result.current.submitting).toBe(false));

    act(() => result.current.setGroupName("Osaka trip"));
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
    const groupId = "018f4c9e-0000-7000-8000-000000000001";
    const group = {
      id: groupId,
      name: "Kyoto trip",
      members: [{ id: "018f4c9e-0000-7000-8000-000000000002", name: "Alice" }],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, group));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCreateGroupForm());
    act(() => result.current.setGroupName("Kyoto trip"));
    act(() => result.current.updateMemberName(0, "Alice"));
    await act(() => result.current.handleSubmit(submitEvent()));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/g/${groupId}`));
  });

  it("surfaces the server's error message and clears submitting on failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(422, { error: "name must be 1-100 characters" }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCreateGroupForm());
    act(() => result.current.setGroupName("Kyoto trip"));
    act(() => result.current.updateMemberName(0, "Alice"));
    await act(() => result.current.handleSubmit(submitEvent()));

    await waitFor(() => expect(result.current.error).toBe("name must be 1-100 characters"));
    expect(result.current.submitting).toBe(false);
  });
});
