"use client";

import { useParams } from "next/navigation";
import { Text } from "@/components/ui/text";
import { ExpenseForm } from "../../../add/expenseForm";
import { useEntry } from "../useEntry";
import { EntryKind } from "@/lib/entry";

export default function EditExpensePage() {
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
  if (!entry || entry.kind !== EntryKind.Expense || reversed) {
    return (
      <div className="p-6">
        <Text variant="muted">
          {reversed
            ? "This expense was already edited or deleted."
            : "Only expenses can be edited."}
        </Text>
      </div>
    );
  }

  return (
    <ExpenseForm
      groupId={groupId}
      group={group}
      editing={entry}
      backHref={`/g/${groupId}/entries/${entryId}`}
    />
  );
}
