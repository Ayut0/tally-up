import type { components } from "./api-types";

type EntryKindType = components["schemas"]["EntryKind"];

/** Named constants for EntryRecord.kind — same rationale as SplitMode in split.ts. */
export const EntryKind = {
  Expense: "expense",
  Settlement: "settlement",
  Reversal: "reversal",
} as const satisfies Record<string, EntryKindType>;
