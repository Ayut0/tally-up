import type { UseFormRegisterReturn } from "react-hook-form";
import type { components } from "@/lib/api-types";
import { SplitMode } from "@/lib/split";
import { Tabs } from "./ui/tabs";
import { Text } from "./ui/text";
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
      <Text variant="label">Split</Text>
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

          {ruleError && <Text variant="error">{ruleError}</Text>}

          {/* design-handoff.md's Equal-mode-only preview strip (§4, panel
              #1d) — Exact/Shares/Percent (#1e-#1g) each show their own
              footer treatment instead (deferred to #55), so gating here
              stops this from doubling up alongside their row lists above. */}
          {mode === SplitMode.Equal && previewRows && (
            <ul className="flex flex-wrap gap-x-[14px] gap-y-[6px] rounded-field bg-highlight p-3">
              {previewRows.map((row) => (
                <li
                  key={row.id}
                  className="font-mono text-[13.5px] font-semibold text-highlight-text tabular-nums"
                >
                  {row.name} {row.formattedShare}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Tabs>
    </div>
  );
}
