"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Text } from "@/components/ui/text";
import { formatYen } from "@/lib/currency";
import { EntryKind } from "@/lib/entry";
import { useEntry } from "./useEntry";

export default function EntryDetailPage() {
  const { groupId, entryId } = useParams<{
    groupId: string;
    entryId: string;
  }>();
  const { group, entry, reversed, loading, error } = useEntry(groupId, entryId);

  if (error) {
    return (
      <div className="p-6">
        <Text variant="error">{error}</Text>
      </div>
    );
  }
  if (loading || !group) {
    return (
      <div className="p-6">
        <Text variant="muted">Loading…</Text>
      </div>
    );
  }
  if (!entry) {
    return (
      <div className="p-6">
        <Text variant="muted">Entry not found.</Text>
      </div>
    );
  }

  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? id;
  // Each participant's share is read off the server-computed postings (the
  // ledger's own numbers, remainder distribution included) rather than
  // recomputed here: a participant's posting is -share, the payer's is
  // +(total - own share), so a payer who also participates nets out.
  const owed = new Map<string, number>();
  for (const p of entry.postings) owed.set(p.member_id, p.amount);
  const isExpense = entry.kind === EntryKind.Expense;
  const isSettlement = entry.kind === EntryKind.Settlement;

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-5 px-[22px] pt-[30px] pb-7">
      <div className="flex items-center gap-3">
        <Link
          href={`/g/${groupId}`}
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-ink/[.15] bg-surface font-mono text-base font-semibold text-ink"
        >
          ‹
        </Link>
        <Text variant="heading" className="text-[22px] font-extrabold tracking-[-.02em] text-ink">
          {isSettlement ? "Payment" : "Expense"}
        </Text>
      </div>

      <div className="flex flex-col gap-1 rounded-card border-[1.5px] border-ink/[.12] bg-surface px-[18px] py-4">
        <Text variant="body" className="text-[15px] font-bold text-ink">
          {entry.memo || entry.kind}
        </Text>
        <Text
          variant="body"
          className="font-mono text-[30px] font-bold text-ink tabular-nums"
          aria-label="Total amount"
        >
          {formatYen(entry.total_amount)}
        </Text>
        <Text variant="body" className="text-[12px] font-medium text-ink/50">
          {nameOf(entry.payer_id)} paid
          {entry.counterparty ? ` ${nameOf(entry.counterparty)}` : ""} · {entry.occurred_on}
        </Text>
        {reversed && (
          <Text variant="body" className="mt-1 text-[12px] font-semibold text-negative">
            Edited or deleted — kept in history, no longer counted.
          </Text>
        )}
      </div>

      {isExpense && (
        <section aria-label="Split" className="flex flex-col gap-2">
          <Text variant="label">
            Split · {(entry.split_rule as { type?: string } | undefined)?.type ?? "equal"}
          </Text>
          <ul className="flex flex-col gap-2">
            {entry.participants.map((id) => {
              // Net posting = payer credit minus own share; add the credit
              // back for the payer so every row shows the person's own share.
              const net = owed.get(id) ?? 0;
              const share = id === entry.payer_id ? entry.total_amount - net : -net;
              return (
                <li
                  key={id}
                  className="flex items-center justify-between rounded-[14px] border-[1.5px] border-ink/[.12] bg-surface px-4 py-[13px]"
                >
                  <Text variant="body" className="text-[15px] font-bold text-ink">
                    {nameOf(id)}
                  </Text>
                  <Text
                    variant="body"
                    className="font-mono text-[15.5px] font-bold text-ink tabular-nums"
                  >
                    {formatYen(share)}
                  </Text>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {isExpense && !reversed && (
        <Link
          href={`/g/${groupId}/entries/${entryId}/edit`}
          className="flex min-h-[52px] items-center justify-center rounded-button bg-accent p-[17px] text-[17px] font-extrabold text-background shadow-pressed"
        >
          Edit
        </Link>
      )}
    </div>
  );
}
