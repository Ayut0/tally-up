"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/textField";
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
    return (
      <div className="p-6">
        <Text variant="error">{error}</Text>
      </div>
    );
  }
  if (!group || !balance) {
    return (
      <div className="p-6">
        <Text variant="muted">Loading…</Text>
      </div>
    );
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
        <Text variant="heading">Record a payment</Text>
        <Link
          href={`/g/${groupId}`}
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          Cancel
        </Link>
      </div>

      <form onSubmit={form.handleSubmit} className="flex flex-col gap-6">
        <Select
          label="Paid by"
          value={form.payerId}
          onChange={form.setPayerId}
          options={group.members.map((member) => ({ id: member.id, label: member.name }))}
        />

        <Select
          label="Pays"
          value={form.counterpartyId}
          onChange={form.setCounterpartyId}
          options={form.counterpartyRows.map((row) => ({
            id: row.id,
            label:
              row.balance > 0
                ? `${row.name} (owed ¥${row.balance.toLocaleString("ja-JP")})`
                : row.name,
          }))}
        />

        <TextField
          label="Amount (¥)"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          placeholder="0"
          value={form.amountInput}
          onChange={(e) => form.setAmountInput(e.target.value)}
        />

        <TextField
          label="Memo (optional)"
          type="text"
          placeholder="e.g. cash"
          value={form.memo}
          onChange={(e) => form.setMemo(e.target.value)}
        />

        <TextField
          label="Date"
          type="date"
          value={form.occurredOn}
          onChange={(e) => form.setOccurredOn(e.target.value)}
        />

        {form.submitError && <Text variant="error">{form.submitError}</Text>}

        <Button type="submit" variant="solid" fullWidth disabled={form.submitDisabled}>
          {form.submitting ? "Recording…" : "Record payment"}
        </Button>
      </form>
    </div>
  );
}
