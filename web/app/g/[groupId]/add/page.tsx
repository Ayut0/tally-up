"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { SplitModeSection } from "@/components/splitModeSection";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { TextField } from "@/components/ui/textField";
import type { components } from "@/lib/api-types";
import { useAddExpenseForm } from "./useAddExpenseForm";
import { useGroup } from "./useGroup";

type GroupRecord = components["schemas"]["GroupRecord"];

export default function AddExpensePage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { group, error: groupError } = useGroup(groupId);

  if (groupError) {
    return <p className="p-6 text-sm text-red-600 dark:text-red-400">{groupError}</p>;
  }
  if (!group) {
    return <p className="p-6 text-sm text-zinc-500">Loading…</p>;
  }

  return <AddExpenseForm groupId={groupId} group={group} />;
}

function AddExpenseForm({ groupId, group }: { groupId: string; group: GroupRecord }) {
  const form = useAddExpenseForm(groupId, group);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Add expense</h1>
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

        <TextField
          label="Total (¥)"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          placeholder="0"
          {...form.registerTotalInput()}
        />

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Participants</span>
          <ul className="flex flex-col gap-1">
            {form.memberRows.map((row) => (
              <li key={row.id}>
                <Checkbox checked={row.checked} onChange={() => form.toggleParticipant(row.id)}>
                  {row.name}
                </Checkbox>
              </li>
            ))}
          </ul>
        </div>

        <SplitModeSection
          mode={form.mode}
          splitTabs={form.splitTabs}
          setMode={form.setMode}
          showExactInputs={form.showExactInputs}
          exactRows={form.exactRows}
          registerAmount={form.registerAmount}
          showWeightInputs={form.showWeightInputs}
          weightRows={form.weightRows}
          registerWeight={form.registerWeight}
          ruleError={form.ruleError}
          previewRows={form.previewRows}
        />

        <TextField
          label="Memo (optional)"
          type="text"
          placeholder="e.g. dinner"
          {...form.registerMemo()}
        />

        <TextField label="Date" type="date" {...form.registerOccurredOn()} />

        {form.submitError && (
          <p className="text-sm text-red-600 dark:text-red-400">{form.submitError}</p>
        )}

        <Button type="submit" variant="solid" fullWidth disabled={form.submitDisabled}>
          {form.submitting ? "Adding…" : "Add expense"}
        </Button>
      </form>
    </div>
  );
}
