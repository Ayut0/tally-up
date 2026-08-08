"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
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

// Every field that binds to a native <input>/<select>/checkbox, or is
// Record-keyed and changes shape as participants are toggled
// (`participants`/`amounts`/`weights`). `mode` is the one field that's
// neither — see the comment at its declaration for why it stays outside.
type FormValues = {
  payerId: string;
  participants: Record<string, boolean>;
  totalInput: string;
  memo: string;
  occurredOn: string;
  amounts: Record<string, number>;
  weights: Record<string, number>;
};

const SPLIT_TABS: { mode: SplitRule["type"]; label: string }[] = [
  { mode: SplitMode.Equal, label: "Equal" },
  { mode: SplitMode.Exact, label: "Exact" },
  { mode: SplitMode.Shares, label: "Shares" },
  { mode: SplitMode.Percent, label: "Percent" },
];

/**
 * Only ever mounts once `group` is loaded, so its defaults (payer,
 * participants) can come straight from lazy useState/useForm initializers
 * reading `group` directly — no effect needed to "apply defaults once they
 * arrive".
 */
export function useAddExpenseForm(groupId: string, group: GroupRecord) {
  const router = useRouter();

  // Stays useState: the split tabs are <button onClick>, not a native input
  // register() can bind, so folding `mode` into the useForm below would
  // still need a setValue(...) wrapper for `setMode` regardless — no
  // reduction in code, just moved where the value lives.
  const [mode, setMode] = useState<SplitRule["type"]>(SplitMode.Equal);

  const {
    register,
    control,
    setValue,
    getValues,
    handleSubmit: rhfHandleSubmit,
    formState,
  } = useForm<FormValues>({
    defaultValues: {
      payerId: getIdentity(groupId) ?? group.members[0]?.id ?? "",
      participants: Object.fromEntries(group.members.map((m) => [m.id, true])),
      totalInput: "",
      memo: "",
      occurredOn: todayLocal(),
      amounts: {},
      weights: {},
    },
  });

  const payerId = useWatch({ control, name: "payerId" });
  const participantsRecord = useWatch({ control, name: "participants" });
  const totalInput = useWatch({ control, name: "totalInput" });
  const memo = useWatch({ control, name: "memo" });
  const occurredOn = useWatch({ control, name: "occurredOn" });
  const amounts = useWatch({ control, name: "amounts" });
  const weights = useWatch({ control, name: "weights" });

  const [submitError, setSubmitError] = useState<string | null>(null);
  const submissionRef = useRef<{ id: string; key: string; signature: string } | null>(null);

  // Imperative setters, kept for the renderHook test suite per #138 — it
  // can't drive register()'s DOM-bound onChange without fabricating an
  // event object. page.tsx uses the registerX bindings below instead; both
  // write the same underlying RHF form state.
  //
  // Reads via getValues(), not the `participantsRecord` watched above:
  // negating a snapshot from the last render is the setState(x + 1) vs
  // setState(prev => prev + 1) footgun, just via setValue — two toggles in
  // the same tick would both read the same stale value. getValues() always
  // returns what's currently committed.
  function toggleParticipant(memberId: string) {
    setValue(`participants.${memberId}`, !getValues(`participants.${memberId}`));
  }

  function setTotalInput(value: string) {
    setValue("totalInput", value);
  }

  function setAmount(memberId: string, value: number) {
    setValue(`amounts.${memberId}`, value);
  }

  function setWeight(memberId: string, value: number) {
    setValue(`weights.${memberId}`, value);
  }

  function registerAmount(memberId: string) {
    return register(`amounts.${memberId}`, { valueAsNumber: true });
  }

  function registerWeight(memberId: string) {
    return register(`weights.${memberId}`, { valueAsNumber: true });
  }

  function memberName(memberId: string): string {
    return group.members.find((m) => m.id === memberId)?.name ?? memberId;
  }

  const participantIds = group.members.map((m) => m.id).filter((id) => participantsRecord[id]);
  const memberRows = group.members.map((m) => ({
    id: m.id,
    name: m.name,
    checked: !!participantsRecord[m.id],
  }));

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

  async function onValid(values: FormValues) {
    if (!result.isValid || !totalValid || values.payerId === "" || participantIds.length === 0) {
      return;
    }

    // Everything but `id` — the part the server's idempotency gate compares
    // a replay's payload against. Reuse the same {id, key} only when this is
    // a retry of the exact same intent; if the user edited the form after a
    // failed attempt, that's a new intent and needs fresh ids, or the server
    // rejects the same key replayed with a different payload as a 422.
    const payload = {
      payer_id: values.payerId,
      // Who is submitting this form, not who paid — may differ from
      // payerId, which the user can change. Falls back to payerId if this
      // browser has no remembered identity in the group.
      requested_by: getIdentity(groupId) ?? values.payerId,
      total_amount: total,
      memo: values.memo.trim() || undefined,
      occurred_on: values.occurredOn,
      split_rule: result.rule,
      participants: participantIds,
    };
    const signature = JSON.stringify(payload);
    if (submissionRef.current?.signature !== signature) {
      submissionRef.current = { id: generateUuidV7(), key: generateUuidV7(), signature };
    }
    const { id, key } = submissionRef.current;

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
    }
  }

  return {
    payerId,
    registerPayerId: () => register("payerId"),
    memberRows,
    toggleParticipant,
    registerParticipant: (memberId: string) => register(`participants.${memberId}`),
    totalInput,
    setTotalInput,
    registerTotalInput: () => register("totalInput"),
    mode,
    setMode,
    splitTabs,
    showExactInputs: mode === SplitMode.Exact,
    showWeightInputs: mode === SplitMode.Shares || mode === SplitMode.Percent,
    exactRows,
    setAmount,
    registerAmount,
    weightRows,
    setWeight,
    registerWeight,
    ruleError,
    previewRows,
    memo,
    registerMemo: () => register("memo"),
    occurredOn,
    registerOccurredOn: () => register("occurredOn"),
    submitting: formState.isSubmitting,
    submitError,
    submitDisabled: !canSubmit || formState.isSubmitting,
    handleSubmit: rhfHandleSubmit(onValid),
  };
}
