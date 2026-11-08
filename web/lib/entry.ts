import type { components } from "./api-types";
import { zSplitRule } from "./api-schemas/zod.gen";

type EntryKindType = components["schemas"]["EntryKind"];

/** Named constants for EntryRecord.kind — same rationale as SplitMode in split.ts. */
export const EntryKind = {
  Expense: "expense",
  Settlement: "settlement",
  Reversal: "reversal",
} as const satisfies Record<string, EntryKindType>;

/**
 * An entry's recorded split rule, narrowed at runtime. The server includes
 * the rule's `type` on expenses, but the generated `EntryRecord` TS type
 * omits it, so the rule is re-validated against the schema rather than
 * asserted into shape. `undefined` for settlements/reversals (no rule).
 */
export function parseSplitRule(rule: unknown): components["schemas"]["SplitRule"] | undefined {
  const parsed = zSplitRule.safeParse(rule);
  return parsed.success ? parsed.data : undefined;
}
