"use client";

import { useParams } from "next/navigation";
import { ExpenseForm } from "./expenseForm";
import { useGroup } from "./useGroup";

export default function AddExpensePage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { group, error: groupError } = useGroup(groupId);

  if (groupError) {
    return <p className="p-6 text-sm text-red-600 dark:text-red-400">{groupError}</p>;
  }
  if (!group) {
    return <p className="p-6 text-sm text-zinc-500">Loading…</p>;
  }

  return <ExpenseForm groupId={groupId} group={group} />;
}
