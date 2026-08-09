"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, addMember, removeMember } from "@/lib/api";
import type { components } from "@/lib/api-types";
import { generateUuidV7 } from "@/lib/uuidv7";

type Member = components["schemas"]["Member"];

/**
 * Adds a member to the group. No navigation happens on success (the form
 * stays on the group home page), so cache invalidation — not a route change
 * — is what makes the new member show up. Same idempotency id/key-reuse
 * pattern as `useAddExpenseForm`/`useRecordPaymentForm`: retrying with the
 * same (trimmed) name reuses the key, a different name gets a fresh one.
 */
export function useAddMember(groupId: string) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const intentRef = useRef<{ name: string; key: string } | null>(null);

  const mutation = useMutation<Member, ApiError, string>({
    mutationFn: (trimmedName) => {
      if (intentRef.current?.name !== trimmedName) {
        intentRef.current = { name: trimmedName, key: generateUuidV7() };
      }
      return addMember(groupId, trimmedName, intentRef.current.key);
    },
    onSuccess: () => {
      intentRef.current = null;
      setName("");
      queryClient.invalidateQueries({ queryKey: ["group", groupId] });
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "" || mutation.isPending) return;
    mutation.mutate(trimmed);
  }

  return {
    name,
    setName,
    submit,
    submitting: mutation.isPending,
    error: mutation.error?.message ?? null,
  };
}

/**
 * Removes a member, gated by a confirm dialog rather than a native
 * `confirm()`. This hook owns the dialog's `ref` and calls
 * `showModal()`/`close()` directly from the same handlers that decide to
 * open/close it (`requestRemove`/`cancelRemove`/on a successful removal) —
 * no effect needed to keep a boolean "open" prop in sync with the dialog's
 * imperative API. `<Dialog ref={dialogRef} {...dialogProps}>` is all a
 * caller needs to wire up; `Dialog` itself renders whatever it's given and
 * makes no decisions of its own.
 *
 * `confirmingId` tracks at most one row's confirm/error state at a time —
 * switching to a different row (or cancelling) resets the mutation so a
 * stale error from a previous attempt doesn't linger. On the 409 (nonzero
 * balance) case, `confirmingId` is deliberately left set so the error
 * renders in the dialog, instead of being swallowed. `requestRemove`/
 * `cancelRemove` are no-ops while a removal is in flight: TanStack Query's
 * `mutation.reset()` detaches the observer from the still-running mutation
 * rather than aborting it, so resetting (or moving `confirmingId` to a
 * different row) while pending would orphan the request — a 409 it later
 * resolves with would have nowhere to render. `dialogProps` closes the same
 * gap at the dialog level: while a removal is pending, `closedby="none"`
 * blocks backdrop-click in supporting browsers, and `onCancel` blocks `Esc`
 * everywhere (`<dialog>` fires a cancelable `cancel` event on `Esc`
 * regardless of `closedby` support) — otherwise a stray dismissal mid-flight
 * would desync the native dialog from `confirmingId`, orphaning that 409
 * with nowhere to render once it arrives.
 */
export function useRemoveMember(groupId: string) {
  const queryClient = useQueryClient();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const mutation = useMutation<void, ApiError, string>({
    mutationFn: (memberId) => removeMember(groupId, memberId),
    onSuccess: () => {
      setConfirmingId(null);
      dialogRef.current?.close();
      queryClient.invalidateQueries({ queryKey: ["group", groupId] });
    },
  });

  function requestRemove(memberId: string) {
    if (mutation.isPending) return;
    mutation.reset();
    setConfirmingId(memberId);
    dialogRef.current?.showModal();
  }

  function cancelRemove() {
    if (mutation.isPending) return;
    mutation.reset();
    setConfirmingId(null);
    dialogRef.current?.close();
  }

  function confirmRemove(memberId: string) {
    mutation.mutate(memberId);
  }

  function isRemoving(memberId: string) {
    return mutation.isPending && mutation.variables === memberId;
  }

  const dismissible = !(confirmingId !== null && isRemoving(confirmingId));

  function closeOnBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (!dismissible || "closedBy" in HTMLDialogElement.prototype) return;
    // Clicking dialog content also targets the <dialog> itself once the
    // event bubbles past it, so this only fires on genuine backdrop clicks
    // if we additionally check the click landed outside the content box.
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const insideContent =
      rect.top <= event.clientY &&
      event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX &&
      event.clientX <= rect.left + rect.width;
    if (!insideContent) event.currentTarget.close();
  }

  function blockCancelWhenNotDismissible(event: React.SyntheticEvent<HTMLDialogElement>) {
    if (!dismissible) event.preventDefault();
  }

  return {
    dialogRef,
    dialogProps: {
      closedby: dismissible ? ("any" as const) : ("none" as const),
      onClose: cancelRemove,
      onCancel: blockCancelWhenNotDismissible,
      onClick: closeOnBackdropClick,
    },
    confirmingId,
    requestRemove,
    cancelRemove,
    confirmRemove,
    isRemoving,
    error:
      confirmingId !== null && mutation.variables === confirmingId
        ? (mutation.error?.message ?? null)
        : null,
  };
}
