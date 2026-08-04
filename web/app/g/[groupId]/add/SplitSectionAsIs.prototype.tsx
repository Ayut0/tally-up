"use client";

import { useState } from "react";
import type { components } from "@/lib/api-types";
import { SplitMode, buildSplitRule, previewShares } from "@/lib/split";
import { SplitSectionOutput } from "./SplitSectionOutput.prototype";
import { formatYen } from "./split-section-shared.prototype";

type SplitRule = components["schemas"]["SplitRule"];

const SPLIT_TABS: { mode: SplitRule["type"]; label: string }[] = [
  { mode: SplitMode.Equal, label: "Equal" },
  { mode: SplitMode.Exact, label: "Exact" },
  { mode: SplitMode.Shares, label: "Shares" },
  { mode: SplitMode.Percent, label: "Percent" },
];

type Props = {
  participantIds: string[];
  memberName: (id: string) => string;
  total: number | undefined;
};

/**
 * PROTOTYPE control group for #141 — today's hand-rolled useState approach
 * (mirrors useAddExpenseForm.ts's split-mode state verbatim), standing alone
 * so it can be compared against SplitSectionRhf.
 */
export function SplitSectionAsIs({ participantIds, memberName, total }: Props) {
  const [mode, setMode] = useState<SplitRule["type"]>(SplitMode.Equal);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [weights, setWeights] = useState<Record<string, number>>({});

  function setAmount(memberId: string, value: number) {
    setAmounts((prev) => ({ ...prev, [memberId]: value }));
  }
  function setWeight(memberId: string, value: number) {
    setWeights((prev) => ({ ...prev, [memberId]: value }));
  }

  const result = buildSplitRule(mode, participantIds, { total, amounts, weights });
  const ruleError = result.isValid ? null : result.error;
  const preview =
    result.isValid && total !== undefined && participantIds.length > 0
      ? previewShares(total, result.rule, participantIds)
      : null;

  const splitTabs = SPLIT_TABS.map((tab) => ({ ...tab, active: tab.mode === mode }));
  const previewRows = preview
    ? participantIds.map((id) => ({
        id,
        name: memberName(id),
        formattedShare: formatYen(preview[id] ?? 0),
      }))
    : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1 rounded-lg border border-black/[.08] p-1 dark:border-white/[.145]">
        {splitTabs.map((tab) => (
          <button
            key={tab.mode}
            type="button"
            onClick={() => setMode(tab.mode)}
            className={`flex-1 rounded-md px-2 py-1 text-sm font-medium transition-colors ${
              tab.active ? "bg-foreground text-background" : "text-zinc-700 dark:text-zinc-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mode === SplitMode.Exact && (
        <ul className="flex flex-col gap-1">
          {participantIds.map((id) => (
            <li key={id} className="flex items-center justify-between gap-2">
              <span className="text-sm text-zinc-950 dark:text-zinc-50">{memberName(id)}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={amounts[id] ?? ""}
                onChange={(e) => setAmount(id, Number(e.target.value))}
                className="w-24 rounded-lg border border-black/[.08] px-3 py-1 text-base dark:border-white/[.145] dark:bg-black"
              />
            </li>
          ))}
        </ul>
      )}

      {(mode === SplitMode.Shares || mode === SplitMode.Percent) && (
        <ul className="flex flex-col gap-1">
          {participantIds.map((id) => (
            <li key={id} className="flex items-center justify-between gap-2">
              <span className="text-sm text-zinc-950 dark:text-zinc-50">{memberName(id)}</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={weights[id] ?? ""}
                onChange={(e) => setWeight(id, Number(e.target.value))}
                className="w-24 rounded-lg border border-black/[.08] px-3 py-1 text-base dark:border-white/[.145] dark:bg-black"
              />
            </li>
          ))}
        </ul>
      )}

      <SplitSectionOutput
        result={{ ruleError, rule: result.isValid ? result.rule : null, previewRows }}
      />
    </div>
  );
}
