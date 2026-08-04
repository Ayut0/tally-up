"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import type { components } from "@/lib/api-types";
import { useGroupAndBalance } from "./useGroupAndBalance";
import { useRecordPaymentForm } from "./useRecordPaymentForm";

type GroupRecord = components["schemas"]["GroupRecord"];
type BalanceSnapshot = components["schemas"]["BalanceSnapshot"];

export default function RecordPaymentPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const searchParams = useSearchParams();
  const { group, balance, error } = useGroupAndBalance(groupId);

  if (error) {
    return <p className="p-6 text-sm text-red-600 dark:text-red-400">{error}</p>;
  }
  if (!group || !balance) {
    return <p className="p-6 text-sm text-zinc-500">Loading…</p>;
  }

  return (
    <RecordPaymentForm
      groupId={groupId}
      group={group}
      balance={balance}
      initialPayerId={searchParams.get("payer") ?? undefined}
      initialCounterpartyId={searchParams.get("counterparty") ?? undefined}
    />
  );
}

function RecordPaymentForm({
  groupId,
  group,
  balance,
  initialPayerId,
  initialCounterpartyId,
}: {
  groupId: string;
  group: GroupRecord;
  balance: BalanceSnapshot;
  initialPayerId?: string;
  initialCounterpartyId?: string;
}) {
  const form = useRecordPaymentForm(groupId, group, balance, {
    initialPayerId,
    initialCounterpartyId,
  });

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Record a payment</h1>
        <Link
          href={`/g/${groupId}`}
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          Cancel
        </Link>
      </div>

      <form onSubmit={form.handleSubmit} className="flex flex-col gap-6">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Paid by</span>
          <select
            value={form.payerId}
            onChange={(e) => form.setPayerId(e.target.value)}
            className="rounded-lg border border-black/[.08] px-3 py-2 text-base dark:border-white/[.145] dark:bg-black"
          >
            {group.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Pays</span>
          <select
            value={form.counterpartyId}
            onChange={(e) => form.setCounterpartyId(e.target.value)}
            className="rounded-lg border border-black/[.08] px-3 py-2 text-base dark:border-white/[.145] dark:bg-black"
          >
            {form.counterpartyRows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
                {row.balance > 0 ? ` (owed ¥${row.balance.toLocaleString("ja-JP")})` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Amount (¥)</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={form.amountInput}
            onChange={(e) => form.setAmountInput(e.target.value)}
            placeholder="0"
            className="rounded-lg border border-black/[.08] px-3 py-2 text-base dark:border-white/[.145] dark:bg-black"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Memo (optional)
          </span>
          <input
            type="text"
            value={form.memo}
            onChange={(e) => form.setMemo(e.target.value)}
            placeholder="e.g. cash"
            className="rounded-lg border border-black/[.08] px-3 py-2 text-base dark:border-white/[.145] dark:bg-black"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Date</span>
          <input
            type="date"
            value={form.occurredOn}
            onChange={(e) => form.setOccurredOn(e.target.value)}
            className="rounded-lg border border-black/[.08] px-3 py-2 text-base dark:border-white/[.145] dark:bg-black"
          />
        </label>

        {form.submitError && (
          <p className="text-sm text-red-600 dark:text-red-400">{form.submitError}</p>
        )}

        <button
          type="submit"
          disabled={form.submitDisabled}
          className="rounded-full bg-foreground px-5 py-3 text-base font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-40 dark:hover:bg-[#ccc]"
        >
          {form.submitting ? "Recording…" : "Record payment"}
        </button>
      </form>
    </div>
  );
}
