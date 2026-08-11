"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Text } from "@/components/ui/text";
import { Wordmark } from "@/components/ui/wordmark";
import { buildBalanceRows } from "@/lib/balance";
import { buildHistoryRows } from "@/lib/history";
import { getIdentity } from "@/lib/identity";
import { BalanceList } from "./balanceList";
import { EmptyLedgerCard } from "./emptyLedger";
import { HistoryList } from "./historyList";
import { InviteBanner } from "./inviteBanner";
import { JoinPicker } from "./join";
import { MemberList } from "./memberList";
import { useGroupData } from "./useGroupData";

export default function GroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { group, balance, entries, error } = useGroupData(groupId);
  // No effect needed: useGroupData's query never resolves during SSR, so
  // `group` is always falsy on the server and on the client's first
  // (hydration) render — the branch below that reads `memberId` is
  // unreachable until well after hydration, so there's nothing for this
  // lazy initializer's client-only value to mismatch against.
  const [memberId, setMemberId] = useState(() => getIdentity(groupId));

  if (error) {
    return (
      <div className="p-6">
        <Text variant="error">{error}</Text>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="p-6">
        <Text variant="muted">Loading…</Text>
      </div>
    );
  }

  if (memberId === null) {
    return <JoinPicker group={group} onPicked={setMemberId} />;
  }

  const balanceRows = buildBalanceRows(group.members, balance?.balances ?? []);
  const historyRows = buildHistoryRows(group.members, entries);
  const isEmpty = entries.length === 0;
  const memberCount = group.members.length;

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-[22px] px-[22px] pt-8 pb-24">
      <header className="flex items-start justify-between">
        <div>
          <Text variant="heading" className="text-[24px] font-extrabold tracking-[-.02em] text-ink">
            {group.name}
          </Text>
          <Text variant="body" className="mt-[5px] text-[12px] font-semibold text-ink/50">
            {memberCount} {memberCount === 1 ? "member" : "members"} · updates live
          </Text>
        </div>
        <Wordmark size="sm" />
      </header>

      {isEmpty ? (
        <EmptyLedgerCard />
      ) : (
        <>
          <BalanceList groupId={groupId} rows={balanceRows} currentMemberId={memberId} />
          <HistoryList rows={historyRows} />
        </>
      )}

      <InviteBanner variant={isEmpty ? "empty" : "default"} />

      <MemberList groupId={groupId} members={group.members} />

      <div className="fixed inset-x-0 bottom-[22px] flex justify-center px-[22px]">
        <Link
          href={`/g/${groupId}/add`}
          aria-label="Add expense"
          className="flex min-h-[56px] w-full max-w-sm items-center justify-center rounded-card bg-accent p-[17px] text-[17px] font-extrabold text-background shadow-[0_4px_14px_rgba(180,86,46,.4),0_3px_0_var(--accent-pressed)]"
        >
          + Add expense
        </Link>
      </div>
    </div>
  );
}
