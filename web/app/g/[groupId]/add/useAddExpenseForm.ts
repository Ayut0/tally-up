"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, addEntry } from "@/lib/api";
import type { components } from "@/lib/api-types";
import { todayLocal } from "@/lib/date";
import { EntryKind } from "@/lib/entry";
import { canSubmitExpense, parseTotal } from "@/lib/expenseForm";
import { getIdentity } from "@/lib/identity";
import { SplitMode, buildSplitRule, previewShares } from "@/lib/split";
import { generateUuidV7 } from "@/lib/uuidv7";

type GroupRecord = components["schemas"]["GroupRecord"];
type SplitRule = components["schemas"]["SplitRule"];

const SPLIT_TABS: { mode: SplitRule["type"]; label: string }[] = [
  { mode: SplitMode.Equal, label: "Equal" },
  { mode: SplitMode.Exact, label: "Exact" },
  { mode: SplitMode.Shares, label: "Shares" },
  { mode: SplitMode.Percent, label: "Percent" },
];

/**
 * Only ever mounts once `group` is loaded, so its defaults (payer,
 * participants) can come straight from lazy useState initializers reading
 * `group` directly — no effect needed to "apply defaults once they arrive".
 */
export function useAddExpenseForm(groupId: string, group: GroupRecord) {
  const router = useRouter();

  const [payerId, setPayerId] = useState(() => getIdentity(groupId) ?? group.members[0]?.id ?? "");
  const [participants, setParticipants] = useState<Set<string>>(
    () => new Set(group.members.map((m) => m.id)),
  );
  const [totalInput, setTotalInput] = useState("");
  const [mode, setMode] = useState<SplitRule["type"]>(SplitMode.Equal);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [memo, setMemo] = useState("");
  const [occurredOn, setOccurredOn] = useState(() => todayLocal());

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submissionRef = useRef<{ id: string; key: string; signature: string } | null>(null);

  function toggleParticipant(memberId: string) {
    setParticipants((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  function setAmount(memberId: string, value: number) {
    setAmounts((prev) => ({ ...prev, [memberId]: value }));
  }

  function setWeight(memberId: string, value: number) {
    setWeights((prev) => ({ ...prev, [memberId]: value }));
  }

  function memberName(memberId: string): string {
    return group.members.find((m) => m.id === memberId)?.name ?? memberId;
  }

  const memberRows = group.members.map((m) => ({
    id: m.id,
    name: m.name,
    checked: participants.has(m.id),
  }));

  const participantIds = [...participants];
  const { total, valid: totalValid } = parseTotal(totalInput);
  const result = buildSplitRule(mode, participantIds, {
    total: totalValid ? total : undefined,
    amounts,
    weights,
  });
  const ruleError = result.isValid ? null : result.error;
  const preview =
    result.isValid && totalValid && participantIds.length > 0
      ? previewShares(total, result.rule, participantIds)
      : null;
  const canSubmit = canSubmitExpense({
    payerId,
    participantCount: participantIds.length,
    totalValid,
    splitValid: result.isValid,
  });

  const splitTabs = SPLIT_TABS.map((tab) => ({ ...tab, active: tab.mode === mode }));
  const exactRows = participantIds.map((id) => ({
    id,
    name: memberName(id),
    amount: amounts[id] ?? "",
  }));
  const weightRows = participantIds.map((id) => ({
    id,
    name: memberName(id),
    weight: weights[id] ?? "",
  }));
  const previewRows = preview
    ? participantIds.map((id) => ({
        id,
        name: memberName(id),
        formattedShare: `¥${(preview[id] ?? 0).toLocaleString("ja-JP")}`,
      }))
    : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!result.isValid || !totalValid || payerId === "" || participantIds.length === 0) return;
    if (submitting) return;

    // Everything but `id` — the part the server's idempotency gate compares
    // a replay's payload against. Reuse the same {id, key} only when this is
    // a retry of the exact same intent; if the user edited the form after a
    // failed attempt, that's a new intent and needs fresh ids, or the server
    // rejects the same key replayed with a different payload as a 422.
    const payload = {
      payer_id: payerId,
      // Who is submitting this form, not who paid — may differ from
      // payerId, which the user can change. Falls back to payerId if this
      // browser has no remembered identity in the group.
      requested_by: getIdentity(groupId) ?? payerId,
      total_amount: total,
      memo: memo.trim() || undefined,
      occurred_on: occurredOn,
      split_rule: result.rule,
      participants: participantIds,
    };
    const signature = JSON.stringify(payload);
    if (submissionRef.current?.signature !== signature) {
      submissionRef.current = { id: generateUuidV7(), key: generateUuidV7(), signature };
    }
    const { id, key } = submissionRef.current;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const entry: components["schemas"]["ExpenseEntry"] = {
        kind: EntryKind.Expense,
        id,
        ...payload,
      };
      await addEntry(groupId, entry, key);
      router.push(`/g/${groupId}`);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      );
      setSubmitting(false);
    }
  }

  return {
    payerId,
    setPayerId,
    memberRows,
    toggleParticipant,
    totalInput,
    setTotalInput,
    mode,
    setMode,
    splitTabs,
    showExactInputs: mode === SplitMode.Exact,
    showWeightInputs: mode === SplitMode.Shares || mode === SplitMode.Percent,
    exactRows,
    setAmount,
    weightRows,
    setWeight,
    ruleError,
    previewRows,
    memo,
    setMemo,
    occurredOn,
    setOccurredOn,
    submitting,
    submitError,
    submitDisabled: !canSubmit || submitting,
    handleSubmit,
  };
}
