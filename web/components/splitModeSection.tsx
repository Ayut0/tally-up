import type { UseFormRegisterReturn } from "react-hook-form";
import type { components } from "@/lib/api-types";
import { Tabs } from "./ui/tabs";
import { TextField } from "./ui/textField";

type SplitRule = components["schemas"]["SplitRule"];

type SplitTab = { mode: SplitRule["type"]; label: string; active: boolean };
type ExactRow = { id: string; name: string; amount: number | string };
type WeightRow = { id: string; name: string; weight: number | string };
type PreviewRow = { id: string; name: string; formattedShare: string };

/**
 * Presentational only, per #138's "components may branch, but may not
 * compute": every row, flag, and label here is already decided by
 * useAddExpenseForm — this component just lays out the JSX for them.
 */
export function SplitModeSection({
  mode,
  splitTabs,
  setMode,
  showExactInputs,
  exactRows,
  registerAmount,
  showWeightInputs,
  weightRows,
  registerWeight,
  ruleError,
  previewRows,
}: {
  mode: SplitRule["type"];
  splitTabs: SplitTab[];
  setMode: (mode: SplitRule["type"]) => void;
  showExactInputs: boolean;
  exactRows: ExactRow[];
  registerAmount: (memberId: string) => UseFormRegisterReturn;
  showWeightInputs: boolean;
  weightRows: WeightRow[];
  registerWeight: (memberId: string) => UseFormRegisterReturn;
  ruleError: string | null;
  previewRows: PreviewRow[] | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Split</span>
      <Tabs
        tabs={splitTabs.map((tab) => ({ id: tab.mode, label: tab.label }))}
        value={mode}
        onChange={setMode}
      >
        <div className="flex flex-col gap-2">
          {showExactInputs && (
            <ul className="flex flex-col gap-3">
              {exactRows.map((row) => (
                <li key={row.id}>
                  <TextField
                    label={row.name}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    {...registerAmount(row.id)}
                  />
                </li>
              ))}
            </ul>
          )}

          {showWeightInputs && (
            <ul className="flex flex-col gap-3">
              {weightRows.map((row) => (
                <li key={row.id}>
                  <TextField
                    label={row.name}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    {...registerWeight(row.id)}
                  />
                </li>
              ))}
            </ul>
          )}

          {ruleError && <p className="text-sm text-red-600 dark:text-red-400">{ruleError}</p>}

          {previewRows && (
            <ul className="flex flex-col gap-1 rounded-lg bg-black/[.03] p-2 text-sm dark:bg-white/[.06]">
              {previewRows.map((row) => (
                <li key={row.id} className="flex items-center justify-between">
                  <span className="text-zinc-700 dark:text-zinc-300">{row.name}</span>
                  <span className="text-zinc-950 dark:text-zinc-50">{row.formattedShare}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Tabs>
    </div>
  );
}
