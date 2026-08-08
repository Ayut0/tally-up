"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useOwes } from "./useOwes";

export default function OwesPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { group, pairs, error } = useOwes(groupId);

  if (error) {
    return <p className="p-6 text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  if (!group || !pairs) {
    return <p className="p-6 text-sm text-zinc-500">Loading…</p>;
  }

  const membersById = new Map(group.members.map((m) => [m.id, m]));
  const nameOf = (memberId: string) => membersById.get(memberId)?.name ?? memberId;

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Who owes whom</h1>
        <Link
          href={`/g/${groupId}`}
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          Back
        </Link>
      </div>

      {pairs.length === 0 ? (
        <p className="text-sm text-zinc-500">All settled up — nobody owes anybody anything.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {pairs.map((pair) => (
            <li
              key={`${pair.debtor_id}:${pair.creditor_id}`}
              className="flex flex-col rounded-lg border border-black/[.08] px-4 py-2 dark:border-white/[.145]"
            >
              <span className="text-base text-zinc-950 dark:text-zinc-50">
                {nameOf(pair.debtor_id)} <span className="text-zinc-500">owes</span>{" "}
                {nameOf(pair.creditor_id)}
              </span>
              <span className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                ¥{pair.amount.toLocaleString("ja-JP")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
