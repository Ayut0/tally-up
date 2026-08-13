"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { SplitModeSection } from "@/components/splitModeSection";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/textField";
import { stripNonDigits } from "@/lib/expenseForm";
import type { components } from "@/lib/api-types";
import { ParticipantPills } from "./participantPills";
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
  const payer = group.members.find((member) => member.id === form.payerId);
  const totalField = form.registerTotalInput();

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
          Add expense
        </Text>
      </div>

      <form onSubmit={form.handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Text variant="label">Total</Text>
          <div className="flex items-baseline gap-[6px] rounded-button border-[1.5px] border-accent bg-surface px-[18px] py-4">
            <Text variant="body" className="font-mono text-xl font-bold text-ink/45">
              ¥
            </Text>
            <input
              {...totalField}
              type="text"
              inputMode="numeric"
              aria-label="Total amount in yen"
              placeholder="0"
              onChange={(e) => {
                e.target.value = stripNonDigits(e.target.value);
                totalField.onChange(e);
              }}
              className="w-full bg-transparent font-mono text-[30px] font-bold text-ink tabular-nums outline-none"
            />
          </div>
          <Text variant="body" className="text-[11.5px] font-medium text-ink/45">
            Whole yen only — no decimals, ever.
          </Text>
        </div>

        <Select
          label="Paid by"
          value={form.payerId}
          onChange={form.setPayerId}
          options={group.members.map((member) => ({ id: member.id, label: member.name }))}
          triggerClassName="flex w-full items-center gap-[10px] rounded-field border-[1.5px] border-ink/[.18] bg-surface px-[14px] py-3"
          renderTrigger={() =>
            payer && (
              <>
                <Avatar
                  memberId={payer.id}
                  initial={payer.name.charAt(0).toUpperCase()}
                  size={28}
                />
                {/* Not <Text>: HeroUI's Paragraph reads an ambient
                    react-aria-components slot context, and HeroSelect.Trigger's
                    subtree provides one scoped to "description"/"errorMessage"
                    only — an unslotted Paragraph nested in here throws "A slot
                    prop is required" at runtime (confirmed live, not a
                    hypothetical). Plain spans sidestep that context entirely. */}
                <span className="flex-1 text-left font-sans text-[15.5px] font-bold text-ink">
                  {payer.name}
                </span>
                <span className="font-mono text-sm text-ink/35">▾</span>
              </>
            )
          }
        />

        <div className="flex flex-col gap-2">
          <Text variant="label">Who shared it?</Text>
          <ParticipantPills rows={form.memberRows} onToggle={form.toggleParticipant} />
        </div>

        <SplitModeSection
          mode={form.mode}
          splitTabs={form.splitTabs}
          setMode={form.setMode}
          showExactInputs={form.showExactInputs}
          exactRows={form.exactRows}
          exactSummary={form.exactSummary}
          registerAmount={form.registerAmount}
          showSharesInputs={form.showSharesInputs}
          sharesRows={form.sharesRows}
          incrementWeight={form.incrementWeight}
          decrementWeight={form.decrementWeight}
          sharesSummary={form.sharesSummary}
          showPercentInputs={form.showPercentInputs}
          percentRows={form.percentRows}
          registerPercent={form.registerPercent}
          percentSummary={form.percentSummary}
          ruleError={form.ruleError}
          previewRows={form.previewRows}
        />

        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Memo"
            labelVariant="label"
            type="text"
            placeholder="e.g. dinner"
            inputClassName="overflow-hidden rounded-field border-[1.5px] border-ink/[.18] bg-surface px-[14px] py-3 text-[14.5px] font-semibold text-ink text-ellipsis whitespace-nowrap"
            {...form.registerMemo()}
          />

          <TextField
            label="Date"
            labelVariant="label"
            type="date"
            inputClassName="rounded-field border-[1.5px] border-ink/[.18] bg-surface px-[14px] py-3 font-mono text-[14.5px] font-semibold text-ink"
            {...form.registerOccurredOn()}
          />
        </div>

        {form.submitError && <Text variant="error">{form.submitError}</Text>}

        <Button type="submit" variant="solid" fullWidth disabled={form.submitDisabled}>
          {form.submitting ? "Adding…" : "Add"}
        </Button>
      </form>
    </div>
  );
}
