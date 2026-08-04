"use client";

import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { type FieldErrors, useForm, useWatch } from "react-hook-form";
import type { components } from "@/lib/api-types";
import { SplitMode, buildSplitRule, previewShares } from "@/lib/split";
import { buildRhfSplitSchema } from "./rhfSplitSchema.prototype";
import { SplitSectionOutput } from "./SplitSectionOutput.prototype";
import { formatYen } from "./split-section-shared.prototype";

type SplitRule = components["schemas"]["SplitRule"];
type FormValues = { amounts: Record<string, number>; weights: Record<string, number> };

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
 * PROTOTYPE for #141 — React Hook Form driving the same split-mode section.
 * `mode` stays a plain useState (not the thing in question); `amounts` /
 * `weights` are RHF-registered dotted paths keyed by member id, per the
 * #139 research doc.
 */
export function SplitSectionRhf({ participantIds, memberName, total }: Props) {
  const [mode, setMode] = useState<SplitRule["type"]>(SplitMode.Equal);

  const schema = useMemo(
    () => buildRhfSplitSchema(mode, participantIds, total),
    [mode, participantIds, total],
  );

  const { register, control, formState, trigger } = useForm<FormValues>({
    defaultValues: { amounts: {}, weights: {} },
    resolver: zodResolver(schema),
    mode: "onChange",
  });

  // zodResolver closes over `schema` at the instant it's constructed above;
  // RHF doesn't know the schema instance changed when `mode`/`total` change,
  // so a fresh validation has to be requested by hand to keep error display
  // live — an RHF-config line the hand-rolled version never needed, since it
  // just recomputes on every render.
  useEffect(() => {
    trigger();
  }, [schema, trigger]);

  const watchedAmounts = useWatch({ control, name: "amounts" });
  const watchedWeights = useWatch({ control, name: "weights" });

  const preview = buildSplitRule(mode, participantIds, {
    total,
    amounts: watchedAmounts,
    weights: watchedWeights,
  });
  const previewRows =
    preview.isValid && total !== undefined && participantIds.length > 0
      ? participantIds.map((id) => ({
          id,
          name: memberName(id),
          formattedShare: formatYen(previewShares(total, preview.rule, participantIds)[id] ?? 0),
        }))
      : null;

  const splitTabs = SPLIT_TABS.map((tab) => ({ ...tab, active: tab.mode === mode }));

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
                {...register(`amounts.${id}`, { valueAsNumber: true })}
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
                {...register(`weights.${id}`, { valueAsNumber: true })}
                className="w-24 rounded-lg border border-black/[.08] px-3 py-1 text-base dark:border-white/[.145] dark:bg-black"
              />
            </li>
          ))}
        </ul>
      )}

      <SplitSectionOutput
        result={{
          ruleError: firstErrorMessage(formState.errors),
          rule: preview.isValid ? preview.rule : null,
          previewRows,
        }}
      />
    </div>
  );
}

function firstErrorMessage(errors: FieldErrors<FormValues>): string | null {
  for (const value of Object.values(errors)) {
    if (!value || typeof value !== "object") continue;
    if ("message" in value && typeof value.message === "string") return value.message;
    const nested = firstErrorMessage(value as FieldErrors<FormValues>);
    if (nested) return nested;
  }
  return null;
}
