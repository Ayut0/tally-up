"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Text } from "@/components/ui/text";
import { useOwes } from "./useOwes";

export default function OwesPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { group, pairs, error } = useOwes(groupId);

  if (error) {
    return (
      <div className="p-6">
        <Text variant="error">{error}</Text>
      </div>
    );
  }

  if (!group || !pairs) {
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
        <Text variant="heading">Who owes whom</Text>
        <Link
          href={`/g/${groupId}`}
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          Back
        </Link>
      </div>

      {pairs.length === 0 ? (
        <Text variant="muted">All settled up — nobody owes anybody anything.</Text>
      ) : (
        <ul className="flex flex-col gap-1">
          {pairs.map((pair) => (
            <li
              key={`${pair.debtor_id}:${pair.creditor_id}`}
              className="flex flex-col rounded-lg border border-black/[.08] px-4 py-2 dark:border-white/[.145]"
            >
              <Text variant="body">
                {nameOf(pair.debtor_id)} <span className="text-zinc-500">owes</span>{" "}
                {nameOf(pair.creditor_id)}
              </Text>
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
