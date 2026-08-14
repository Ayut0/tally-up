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
import {
  SplitMode,
  buildSplitRule,
  finiteOr,
  previewShares,
  sumEntered,
  weightedPreview,
} from "@/lib/split";
import { generateUuidV7 } from "@/lib/uuidv7";

type GroupRecord = components["schemas"]["GroupRecord"];
type SplitRule = components["schemas"]["SplitRule"];

// Every field the form tracks, whether bound via register() (totalInput,
// memo, occurredOn, amounts, weights) or via imperative setters
// (payerId, participants — see the comment above toggleParticipant/
// setPayerId for why). `mode` is the one field that's neither — see the
// comment at its declaration for why it stays outside this useForm().
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

  // Imperative setters. Originally added for the renderHook test suite per
  // #138 (it can't drive register()'s DOM-bound onChange without
  // fabricating an event object) alongside register()-spread bindings for
  // page.tsx; #199 moved page.tsx onto these directly too, since
  // Checkbox/Select (HeroUI's react-aria-components-backed non-native
  // controls) are controlled via boolean/key state, not a DOM onChange
  // event, and can't consume a register() spread either.
  //
  // Reads via getValues(), not the `participantsRecord` watched above:
  // negating a snapshot from the last render is the setState(x + 1) vs
  // setState(prev => prev + 1) footgun, just via setValue — two toggles in
  // the same tick would both read the same stale value. getValues() always
  // returns what's currently committed.
  function toggleParticipant(memberId: string) {
    setValue(`participants.${memberId}`, !getValues(`participants.${memberId}`));
  }

  function setPayerId(value: string) {
    setValue("payerId", value);
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

  function registerPercent(memberId: string) {
    return register(`weights.${memberId}`, { valueAsNumber: true });
  }

  // Shares' UI is a stepper, not a text field (see splitModeSection.tsx) —
  // both directions go through setWeight so a missing entry (never
  // stepped) and an explicit one are adjusted the same way, off the
  // effective (defaulted-to-1) value every row already displays. Reads via
  // getValues(), not the watched `weights` above, for the same reason
  // toggleParticipant does above: two clicks in the same tick would
  // otherwise both read the same stale render's value. finiteOr (not `??`)
  // because a NaN left over from Percent (they share this field, and a
  // cleared valueAsNumber field is NaN, not undefined) would otherwise
  // stick the stepper at NaN forever — `NaN ?? 1` is still NaN.
  function incrementWeight(memberId: string) {
    setWeight(memberId, finiteOr(getValues(`weights.${memberId}`), 1) + 1);
  }

  function decrementWeight(memberId: string) {
    setWeight(memberId, Math.max(1, finiteOr(getValues(`weights.${memberId}`), 1) - 1));
  }

  function memberName(memberId: string): string {
    return group.members.find((m) => m.id === memberId)?.name ?? memberId;
  }

  function formatYen(n: number): string {
    return `¥${n.toLocaleString("ja-JP")}`;
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
  const previewRows = preview
    ? participantIds.map((id) => ({
        id,
        name: memberName(id),
        formattedShare: formatYen(preview[id] ?? 0),
      }))
    : null;

  // Shares always defaults a missing *or* NaN (a field cleared via
  // valueAsNumber, possibly carried over from Percent — they share this
  // field) weight to 1, mirroring buildSplitRule, so the stepper and its
  // live preview read off the same effective map rather than the raw,
  // possibly-sparse `weights` field.
  const effectiveShareWeights = Object.fromEntries(
    participantIds.map((id) => [id, finiteOr(weights[id], 1)]),
  );
  const sharesPreview = weightedPreview(total, effectiveShareWeights, participantIds);
  const sharesRows = participantIds.map((id) => ({
    id,
    name: memberName(id),
    weight: effectiveShareWeights[id]!,
    formattedShare: formatYen(sharesPreview[id] ?? 0),
  }));

  const percentPreview = weightedPreview(total, weights, participantIds);
  const percentRows = group.members.map((m) =>
    participantsRecord[m.id]
      ? {
          id: m.id,
          name: m.name,
          active: true as const,
          percent: weights[m.id] ?? "",
          formattedShare: formatYen(percentPreview[m.id] ?? 0),
        }
      : { id: m.id, name: m.name, active: false as const },
  );

  // Same gate `preview` above already applies (totalValid && at least one
  // participant) — without it, deselecting everyone would leave a footer
  // bar floating over an empty row list instead of hiding along with it.
  const showSummaries = totalValid && participantIds.length > 0;
  const exactSummary = showSummaries
    ? {
        enteredFormatted: formatYen(sumEntered(amounts, participantIds)),
        targetFormatted: formatYen(total),
        matches: mode === SplitMode.Exact && result.isValid,
      }
    : null;
  const sharesSummary = showSummaries
    ? {
        count: sumEntered(effectiveShareWeights, participantIds),
        totalFormatted: formatYen(total),
      }
    : null;
  const percentSummary = showSummaries
    ? {
        percentTotal: sumEntered(weights, participantIds),
        totalFormatted: formatYen(total),
        complete: mode === SplitMode.Percent && result.isValid,
      }
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
    setPayerId,
    memberRows,
    toggleParticipant,
    totalInput,
    setTotalInput,
    registerTotalInput: () => register("totalInput"),
    mode,
    setMode,
    splitTabs,
    showExactInputs: mode === SplitMode.Exact,
    showSharesInputs: mode === SplitMode.Shares,
    showPercentInputs: mode === SplitMode.Percent,
    exactRows,
    exactSummary,
    setAmount,
    registerAmount,
    sharesRows,
    incrementWeight,
    decrementWeight,
    sharesSummary,
    percentRows,
    setWeight,
    registerPercent,
    percentSummary,
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
