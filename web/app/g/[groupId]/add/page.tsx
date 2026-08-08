"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { SplitModeSection } from "@/components/splitModeSection";
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
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Paid by</span>
          <select
            {...form.registerPayerId()}
            className="rounded-lg border border-black/[.08] px-3 py-2 text-base dark:border-white/[.145] dark:bg-black"
          >
            {group.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Total (¥)</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            {...form.registerTotalInput()}
            placeholder="0"
            className="rounded-lg border border-black/[.08] px-3 py-2 text-base dark:border-white/[.145] dark:bg-black"
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Participants</span>
          <ul className="flex flex-col gap-1">
            {form.memberRows.map((row) => (
              <li key={row.id}>
                <label className="flex items-center gap-2 text-base text-zinc-950 dark:text-zinc-50">
                  <input type="checkbox" {...form.registerParticipant(row.id)} />
                  {row.name}
                </label>
              </li>
            ))}
          </ul>
        </div>

        <SplitModeSection
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

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Memo (optional)
          </span>
          <input
            type="text"
            {...form.registerMemo()}
            placeholder="e.g. dinner"
            className="rounded-lg border border-black/[.08] px-3 py-2 text-base dark:border-white/[.145] dark:bg-black"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Date</span>
          <input
            type="date"
            {...form.registerOccurredOn()}
            className="rounded-lg border border-black/[.08] px-3 py-2 text-base dark:border-white/[.145] dark:bg-black"
          />
        </label>

        {form.submitError && (
          <p className="text-sm text-red-600 dark:text-red-400">{form.submitError}</p>
        )}

        <button
          type="submit"
          disabled={form.submitDisabled}
          className="rounded-full bg-foreground px-5 py-3 text-base font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-40 dark:hover:bg-[#ccc]"
        >
          {form.submitting ? "Adding…" : "Add expense"}
        </button>
      </form>
    </div>
  );
}
