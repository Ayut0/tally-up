"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, addEntry } from "@/lib/api";
import type { components } from "@/lib/api-types";
import { todayLocal } from "@/lib/date";
import { EntryKind } from "@/lib/entry";
import { parseTotal } from "@/lib/expenseForm";
import { getIdentity } from "@/lib/identity";
import { generateUuidV7 } from "@/lib/uuidv7";

type GroupRecord = components["schemas"]["GroupRecord"];
type BalanceSnapshot = components["schemas"]["BalanceSnapshot"];

type InitialIds = {
  initialPayerId?: string;
  initialCounterpartyId?: string;
};

/** Members other than `excludeId`, creditors (positive balance, descending) first, then the rest in member order. */
function orderedCounterparties(
  group: GroupRecord,
  balance: BalanceSnapshot,
  excludeId: string,
): { id: string; name: string; balance: number }[] {
  const balanceByMember = new Map(balance.balances.map((b) => [b.member_id, b.balance]));
  const others = group.members
    .filter((m) => m.id !== excludeId)
    .map((m) => ({ id: m.id, name: m.name, balance: balanceByMember.get(m.id) ?? 0 }));
  const creditors = others.filter((m) => m.balance > 0).sort((a, b) => b.balance - a.balance);
  const rest = others.filter((m) => m.balance <= 0);
  return [...creditors, ...rest];
}

/**
 * Only ever mounts once `group`/`balance` are loaded, so defaults can come
 * straight from lazy useState initializers reading them directly — same
 * reasoning as useAddExpenseForm.
 */
export function useRecordPaymentForm(
  groupId: string,
  group: GroupRecord,
  balance: BalanceSnapshot,
  { initialPayerId, initialCounterpartyId }: InitialIds,
) {
  const router = useRouter();

  const [payerId, setPayerIdState] = useState(
    () => initialPayerId ?? getIdentity(groupId) ?? group.members[0]?.id ?? "",
  );
  const [counterpartyId, setCounterpartyId] = useState(
    () => initialCounterpartyId ?? orderedCounterparties(group, balance, payerId)[0]?.id ?? "",
  );
  const [amountInput, setAmountInput] = useState("");
  const [memo, setMemo] = useState("");
  const [occurredOn, setOccurredOn] = useState(() => todayLocal());

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submissionRef = useRef<{ id: string; key: string; signature: string } | null>(null);

  function setPayerId(memberId: string) {
    setPayerIdState(memberId);
    if (memberId === counterpartyId) {
      setCounterpartyId(orderedCounterparties(group, balance, memberId)[0]?.id ?? "");
    }
  }

  const counterpartyRows = orderedCounterparties(group, balance, payerId);
  const { total: amount, valid: amountValid } = parseTotal(amountInput);
  const submitDisabled =
    submitting ||
    payerId === "" ||
    counterpartyId === "" ||
    counterpartyId === payerId ||
    !amountValid;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitDisabled) return;

    const payload = {
      payer_id: payerId,
      requested_by: getIdentity(groupId) ?? payerId,
      counterparty: counterpartyId,
      total_amount: amount,
      memo: memo.trim() || undefined,
      occurred_on: occurredOn,
    };
    const signature = JSON.stringify(payload);
    if (submissionRef.current?.signature !== signature) {
      submissionRef.current = { id: generateUuidV7(), key: generateUuidV7(), signature };
    }
    const { id, key } = submissionRef.current;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const entry: components["schemas"]["SettlementEntry"] = {
        kind: EntryKind.Settlement,
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
    counterpartyId,
    setCounterpartyId,
    counterpartyRows,
    amountInput,
    setAmountInput,
    memo,
    setMemo,
    occurredOn,
    setOccurredOn,
    submitting,
    submitError,
    submitDisabled,
    handleSubmit,
  };
}
