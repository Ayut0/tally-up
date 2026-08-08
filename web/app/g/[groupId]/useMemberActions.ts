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
 * Removes a member, gated by a two-tap confirm (`requestRemove` then
 * `confirmRemove`) rather than a native `confirm()` dialog. `confirmingId`
 * tracks at most one row's confirm/error state at a time — switching to a
 * different row (or cancelling) resets the mutation so a stale error from a
 * previous attempt doesn't linger. On the 409 (nonzero balance) case,
 * `confirmingId` is deliberately left set so the error renders next to the
 * row that caused it, instead of being swallowed.
 */
export function useRemoveMember(groupId: string) {
  const queryClient = useQueryClient();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const mutation = useMutation<void, ApiError, string>({
    mutationFn: (memberId) => removeMember(groupId, memberId),
    onSuccess: () => {
      setConfirmingId(null);
      queryClient.invalidateQueries({ queryKey: ["group", groupId] });
    },
  });

  function requestRemove(memberId: string) {
    mutation.reset();
    setConfirmingId(memberId);
  }

  function cancelRemove() {
    mutation.reset();
    setConfirmingId(null);
  }

  function confirmRemove(memberId: string) {
    mutation.mutate(memberId);
  }

  function isRemoving(memberId: string) {
    return mutation.isPending && mutation.variables === memberId;
  }

  return {
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
