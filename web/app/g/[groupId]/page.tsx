"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getIdentity } from "@/lib/identity";
import { JoinPicker } from "./join";
import { useGroupData } from "./useGroupData";

export default function GroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { group, balance, entries, error } = useGroupData(groupId);
  // undefined = "not checked yet" — deferred to an effect (not a useState
  // initializer) so the server render, which has no localStorage, never
  // disagrees with the client's first render.
  const [memberId, setMemberId] = useState<string | null | undefined>(undefined);
  const [inviteUrl, setInviteUrl] = useState("");

  useEffect(() => {
    setMemberId(getIdentity(groupId));
  }, [groupId]);

  useEffect(() => {
    setInviteUrl(window.location.href);
  }, [groupId]);

  if (error) {
    return <p className="p-6 text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  if (!group || memberId === undefined) {
    return <p className="p-6 text-sm text-zinc-500">Loading…</p>;
  }

  if (memberId === null) {
    return <JoinPicker group={group} onPicked={setMemberId} />;
  }

  const membersById = new Map(group.members.map((m) => [m.id, m]));
  const balanceByMember = new Map((balance?.balances ?? []).map((b) => [b.member_id, b.balance]));
  const reversedIds = new Set(
    entries.filter((e) => e.kind === "reversal" && e.reverses_id).map((e) => e.reverses_id!),
  );
  const history = [...entries].reverse();

  async function copyInviteLink() {
    await navigator.clipboard.writeText(inviteUrl);
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 p-6 pb-24">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">{group.name}</h1>
        <button
          type="button"
          onClick={copyInviteLink}
          className="self-start truncate text-xs text-zinc-500 hover:underline"
        >
          {inviteUrl || "…"} · copy invite link
        </button>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Balances</h2>
        <ul className="flex flex-col gap-1">
          {group.members.map((member) => {
            const amount = balanceByMember.get(member.id) ?? 0;
            return (
              <li
                key={member.id}
                className="flex items-center justify-between rounded-lg border border-black/[.08] px-4 py-2 dark:border-white/[.145]"
              >
                <span className="text-base text-zinc-950 dark:text-zinc-50">{member.name}</span>
                <span
                  className={
                    amount > 0
                      ? "text-green-600 dark:text-green-400"
                      : amount < 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-zinc-500"
                  }
                >
                  ¥{amount.toLocaleString("ja-JP")}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-zinc-500">No entries yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {history.map((entry) => {
              const struck = entry.kind === "reversal" || reversedIds.has(entry.id);
              const payer = membersById.get(entry.payer_id)?.name ?? entry.payer_id;
              return (
                <li
                  key={entry.id}
                  className={`flex items-center justify-between rounded-lg border border-black/[.08] px-4 py-2 dark:border-white/[.145] ${
                    struck ? "line-through opacity-60" : ""
                  }`}
                >
                  <span className="flex flex-col">
                    <span className="text-sm text-zinc-950 dark:text-zinc-50">
                      {entry.memo || entry.kind}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {payer} · {entry.occurred_on}
                    </span>
                  </span>
                  <span className="text-sm text-zinc-950 dark:text-zinc-50">
                    ¥{entry.total_amount.toLocaleString("ja-JP")}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Link
        href={`/g/${groupId}/add`}
        aria-label="Add expense"
        className="fixed right-6 bottom-6 flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-2xl text-background shadow-lg transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
      >
        +
      </Link>
    </div>
  );
}
