import type { components } from "@/lib/api-types";

type SplitRule = components["schemas"]["SplitRule"];

/**
 * PROTOTYPE for #141 — shared output shape both split-section variants
 * (SplitSectionAsIs / SplitSectionRhf) produce, so the read-only display
 * of results is identical and only the input mechanics differ.
 */
export type SplitSectionResult = {
  ruleError: string | null;
  rule: SplitRule | null;
  previewRows: { id: string; name: string; formattedShare: string }[] | null;
};

export function formatYen(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}
