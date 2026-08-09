"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Text } from "@/components/ui/text";
import { transferKey } from "@/lib/settle";
import { useRecordTransfer, useSettlePlan } from "./useSettlePlan";

export default function SettlePage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { group, plan, error } = useSettlePlan(groupId);
  const { record, recording, pendingKey, error: recordError } = useRecordTransfer(groupId);

  if (error) {
    return (
      <div className="p-6">
        <Text variant="error">{error}</Text>
      </div>
    );
  }

  if (!group || !plan) {
    return (
      <div className="p-6">
        <Text variant="muted">Loading…</Text>
      </div>
    );
  }

  const membersById = new Map(group.members.map((m) => [m.id, m]));
  const nameOf = (memberId: string) => membersById.get(memberId)?.name ?? memberId;

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <Text variant="heading">Settle up</Text>
        <Link
          href={`/g/${groupId}`}
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          Back
        </Link>
      </div>

      {plan.transfers.length === 0 ? (
        <Text variant="muted">All settled up — every balance is ¥0.</Text>
      ) : (
        // Rendered straight from the polled plan, with no local copy: a
        // transfer a recompute has dropped simply has no row, so it cannot be
        // tapped. That is issue #150's requirement, and the only thing keeping
        // it true is the absence of state here.
        <ul className="flex flex-col gap-1">
          {plan.transfers.map((transfer) => {
            const key = transferKey(transfer);
            const description = `${nameOf(transfer.from)} pays ${nameOf(transfer.to)} ¥${transfer.amount.toLocaleString("ja-JP")}`;
            return (
              <li
                key={key}
                className="flex items-center justify-between gap-3 rounded-lg border border-black/[.08] px-4 py-2 dark:border-white/[.145]"
              >
                <span className="flex flex-col">
                  <Text variant="body">
                    {nameOf(transfer.from)} <span className="text-zinc-500">pays</span>{" "}
                    {nameOf(transfer.to)}
                  </Text>
                  <span className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                    ¥{transfer.amount.toLocaleString("ja-JP")}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <button
                    type="button"
                    onClick={() => record(transfer)}
                    // Without this every row's button is announced as the same
                    // bare "Mark paid", with nothing to say which payment it
                    // records.
                    aria-label={`Mark paid: ${description}`}
                    // Every row is disabled while any record is in flight, not
                    // just this one: the plan has not been recomputed yet, so a
                    // tap on another row would be acting on a stale proposal.
                    disabled={recording}
                    className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-40 dark:hover:bg-[#ccc]"
                  >
                    {pendingKey === key ? "Recording…" : "Mark paid"}
                  </button>
                  {/* Escape hatch for a payment that isn't for this exact
                      proposed amount — partial, rounded, or fronted (#161).
                      Deep-links with payer/counterparty prefilled so only the
                      amount needs typing. */}
                  <Link
                    href={`/g/${groupId}/record-payment?payer=${transfer.from}&counterparty=${transfer.to}`}
                    aria-label={`Different amount: ${description}`}
                    className="text-xs text-zinc-500 hover:underline dark:text-zinc-400"
                  >
                    Different amount →
                  </Link>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {recordError && <Text variant="error">{recordError}</Text>}
    </div>
  );
}
