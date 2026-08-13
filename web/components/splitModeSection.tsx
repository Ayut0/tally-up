import type { UseFormRegisterReturn } from "react-hook-form";
import type { components } from "@/lib/api-types";
import { SplitMode } from "@/lib/split";
import { Button } from "./ui/button";
import { Tabs } from "./ui/tabs";
import { Text } from "./ui/text";

// Hides the native number spinner (Exact/Percent's per-row boxes render
// their own ¥/% affixes instead) without fighting Chrome's/Firefox's
// separate pseudo-elements.
const NUMBER_INPUT_CLASS_NAME =
  "min-w-0 flex-1 bg-transparent text-right font-mono text-base font-bold text-ink tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

type SplitRule = components["schemas"]["SplitRule"];

type SplitTab = { mode: SplitRule["type"]; label: string; active: boolean };
type ExactRow = { id: string; name: string; amount: number | string };
type ExactSummary = { enteredFormatted: string; targetFormatted: string; matches: boolean };
type SharesRow = { id: string; name: string; weight: number; formattedShare: string };
type SharesSummary = { count: number; totalFormatted: string };
type PercentRow =
  | { id: string; name: string; active: true; percent: number | string; formattedShare: string }
  | { id: string; name: string; active: false };
type PercentSummary = { percentTotal: number; totalFormatted: string; complete: boolean };
type PreviewRow = { id: string; name: string; formattedShare: string };

// design-handoff.md's per-mode helper copy (§4, panels #1e-#1g) — static
// text, not derived from any prop, so it lives inline rather than round-
// tripping through the hook.
const MODE_HELPER_TEXT: Record<SplitRule["type"], string | null> = {
  equal: null,
  exact: "Enter each person's exact amount. Must add up to the total.",
  shares: "Weight by shares — e.g. a couple counts as 2. Amounts reflow live.",
  percent:
    "Percentages must total 100. The preview shows the exact yen booked — rounding included.",
};

/**
 * design-handoff.md's #f3e7c9 confirmation bar (§4, panels #1e-#1g) — one
 * per mode, gated by its summary prop being non-null (the hook returns
 * null until a valid total exists, mirroring how `previewRows` already
 * gates the Equal-mode strip below).
 */
function SummaryBar({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-center justify-between rounded-field bg-highlight px-[14px] py-3">
      <Text variant="body" className="text-[13px] font-bold text-highlight-text">
        {left}
      </Text>
      <Text variant="body" className="font-mono text-sm font-bold text-highlight-text tabular-nums">
        {right}
      </Text>
    </div>
  );
}

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
  exactSummary,
  registerAmount,
  showSharesInputs,
  sharesRows,
  incrementWeight,
  decrementWeight,
  sharesSummary,
  showPercentInputs,
  percentRows,
  registerPercent,
  percentSummary,
  ruleError,
  previewRows,
}: {
  mode: SplitRule["type"];
  splitTabs: SplitTab[];
  setMode: (mode: SplitRule["type"]) => void;
  showExactInputs: boolean;
  exactRows: ExactRow[];
  exactSummary: ExactSummary | null;
  registerAmount: (memberId: string) => UseFormRegisterReturn;
  showSharesInputs: boolean;
  sharesRows: SharesRow[];
  incrementWeight: (memberId: string) => void;
  decrementWeight: (memberId: string) => void;
  sharesSummary: SharesSummary | null;
  showPercentInputs: boolean;
  percentRows: PercentRow[];
  registerPercent: (memberId: string) => UseFormRegisterReturn;
  percentSummary: PercentSummary | null;
  ruleError: string | null;
  previewRows: PreviewRow[] | null;
}) {
  const helperText = MODE_HELPER_TEXT[mode];

  return (
    <div className="flex flex-col gap-2">
      <Text variant="label">Split</Text>
      <Tabs
        tabs={splitTabs.map((tab) => ({ id: tab.mode, label: tab.label }))}
        value={mode}
        onChange={setMode}
      >
        <div className="flex flex-col gap-2">
          {helperText && (
            <Text variant="body" className="text-[12.5px] leading-[1.4] font-medium text-ink/[.55]">
              {helperText}
            </Text>
          )}

          {showExactInputs && (
            <ul className="flex flex-col gap-2">
              {exactRows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center gap-3 rounded-field border-[1.5px] border-ink/[.15] bg-surface px-[14px] py-[11px]"
                >
                  <Text variant="body" className="flex-1 text-[15px] font-bold text-ink">
                    {row.name}
                  </Text>
                  {/* bg-background (not the mockup's literal #faf6ee) —
                      globals.css already established #faf6ee is the mockup
                      tool's own canvas bg, not a product surface; the app
                      canvas tone is the closest real token for this
                      recessed-against-a-white-row look. */}
                  <div className="flex min-w-[96px] items-baseline gap-1 rounded-segment border-[1.5px] border-ink/20 bg-background px-3 py-2">
                    <Text variant="body" className="font-mono text-xs font-semibold text-ink/40">
                      ¥
                    </Text>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      aria-label={`${row.name}'s exact amount`}
                      className={NUMBER_INPUT_CLASS_NAME}
                      {...registerAmount(row.id)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {showSharesInputs && (
            <ul className="flex flex-col gap-2">
              {sharesRows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center gap-3 rounded-field border-[1.5px] border-ink/[.15] bg-surface px-[14px] py-[11px]"
                >
                  <div className="min-w-0 flex-1">
                    <Text variant="body" className="text-[15px] font-bold text-ink">
                      {row.name}
                    </Text>
                    <Text
                      variant="body"
                      className="mt-0.5 font-mono text-xs font-semibold text-ink/45 tabular-nums"
                    >
                      → {row.formattedShare}
                    </Text>
                  </div>
                  <div className="flex items-center gap-[10px]">
                    <Button
                      variant="stepper"
                      aria-label={`Decrease ${row.name}'s shares`}
                      disabled={row.weight <= 1}
                      onClick={() => decrementWeight(row.id)}
                    >
                      −
                    </Button>
                    <Text
                      variant="body"
                      className="min-w-5 text-center font-mono text-[17px] font-bold text-ink"
                    >
                      {row.weight}
                    </Text>
                    <Button
                      variant="stepper"
                      aria-label={`Increase ${row.name}'s shares`}
                      onClick={() => incrementWeight(row.id)}
                    >
                      +
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {showPercentInputs && (
            <ul className="flex flex-col gap-2">
              {percentRows.map((row) =>
                row.active ? (
                  <li
                    key={row.id}
                    className="flex items-center gap-3 rounded-field border-[1.5px] border-ink/[.15] bg-surface px-[14px] py-[11px]"
                  >
                    <div className="min-w-0 flex-1">
                      <Text variant="body" className="text-[15px] font-bold text-ink">
                        {row.name}
                      </Text>
                      <Text
                        variant="body"
                        className="mt-0.5 font-mono text-xs font-semibold text-ink/45 tabular-nums"
                      >
                        → {row.formattedShare}
                      </Text>
                    </div>
                    <div className="flex min-w-[72px] items-baseline gap-1 rounded-segment border-[1.5px] border-ink/20 bg-background px-3 py-2">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={1}
                        step={1}
                        aria-label={`${row.name}'s percent share`}
                        className={NUMBER_INPUT_CLASS_NAME}
                        {...registerPercent(row.id)}
                      />
                      <Text variant="body" className="font-mono text-xs font-semibold text-ink/40">
                        %
                      </Text>
                    </div>
                  </li>
                ) : (
                  <li
                    key={row.id}
                    className="flex items-center gap-3 rounded-field border-[1.5px] border-ink/[.08] bg-surface/45 px-[14px] py-[11px] opacity-55"
                  >
                    <Text variant="body" className="flex-1 text-[15px] font-bold text-ink">
                      {row.name}{" "}
                      <span className="font-sans text-[11.5px] font-semibold text-ink/50">
                        — not sharing
                      </span>
                    </Text>
                    <Text
                      variant="body"
                      className="font-mono text-[13px] font-semibold text-ink/35"
                    >
                      —
                    </Text>
                  </li>
                ),
              )}
            </ul>
          )}

          {ruleError && <Text variant="error">{ruleError}</Text>}

          {showExactInputs && exactSummary && (
            <SummaryBar
              left={exactSummary.matches ? "Adds up ✓" : "Entered so far"}
              right={`${exactSummary.enteredFormatted} / ${exactSummary.targetFormatted}`}
            />
          )}

          {showSharesInputs && sharesSummary && (
            <SummaryBar
              left={`${sharesSummary.count} share${sharesSummary.count === 1 ? "" : "s"} total`}
              right={`${sharesSummary.totalFormatted} booked exactly`}
            />
          )}

          {showPercentInputs && percentSummary && (
            <SummaryBar
              left={`${percentSummary.percentTotal}%${percentSummary.complete ? " ✓" : ""}`}
              right={
                percentSummary.complete
                  ? `${percentSummary.totalFormatted} booked exactly`
                  : percentSummary.totalFormatted
              }
            />
          )}

          {/* design-handoff.md's Equal-mode-only preview strip (§4, panel
              #1d) — Exact/Shares/Percent (#1e-#1g) each show their own
              footer treatment above instead, so gating here stops this from
              doubling up alongside their row lists above. */}
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
