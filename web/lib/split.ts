import type { components } from "./api-types";

type SplitRule = components["schemas"]["SplitRule"];

/**
 * Named constants for SplitRule's discriminant, instead of bare string
 * literals scattered through this file. Not a TS `enum`: a real enum's
 * members are a distinct nominal type and wouldn't be directly assignable
 * to the `"equal" | "exact" | ...` literal union the generated api-types.ts
 * declares (spec/openapi.yaml is the single source of truth for these
 * values, per #93) — this `as const` object's property types collapse to
 * those exact literals, so it stays interchangeable with SplitRule["type"].
 */
export const SplitMode = {
  Equal: "equal",
  Exact: "exact",
  Shares: "shares",
  Percent: "percent",
} as const satisfies Record<string, SplitRule["type"]>;

type BuildInputs = {
  total?: number;
  amounts?: Record<string, number>;
  weights?: Record<string, number>;
};

export type BuildSplitRuleResult =
  | { isValid: true; rule: SplitRule }
  | { isValid: false; error: string };

/** Builds a SplitRule from form state, or a validation error. */
export function buildSplitRule(
  mode: SplitRule["type"],
  participants: string[],
  inputs: BuildInputs,
): BuildSplitRuleResult {
  switch (mode) {
    case SplitMode.Equal:
      return { isValid: true, rule: { type: SplitMode.Equal } };
    case SplitMode.Exact: {
      const amounts = pick(inputs.amounts, participants);
      if (typeof amounts === "string") return { isValid: false, error: amounts };
      if (Object.values(amounts).some((v) => v < 0 || !Number.isInteger(v)))
        return { isValid: false, error: "amounts must be whole yen, and none may be negative" };
      if (inputs.total === undefined) return { isValid: false, error: "total amount required" };
      const sum = Object.values(amounts).reduce((a, b) => a + b, 0);
      if (sum !== inputs.total)
        return { isValid: false, error: `amounts sum to ¥${sum}, total is ¥${inputs.total}` };
      return { isValid: true, rule: { type: SplitMode.Exact, amounts } };
    }
    case SplitMode.Shares: {
      const weights = pick(inputs.weights, participants);
      if (typeof weights === "string") return { isValid: false, error: weights };
      if (Object.values(weights).some((v) => v <= 0 || !Number.isInteger(v)))
        return { isValid: false, error: "shares must be positive whole numbers" };
      return { isValid: true, rule: { type: SplitMode.Shares, weights } };
    }
    case SplitMode.Percent: {
      const weights = pick(inputs.weights, participants);
      if (typeof weights === "string") return { isValid: false, error: weights };
      if (Object.values(weights).some((v) => v <= 0 || !Number.isInteger(v)))
        return { isValid: false, error: "percentages must be positive whole numbers" };
      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      if (sum !== 100) return { isValid: false, error: `percentages sum to ${sum}, must be 100` };
      return { isValid: true, rule: { type: SplitMode.Percent, weights } };
    }
  }
}

function pick(
  values: Record<string, number> | undefined,
  participants: string[],
): Record<string, number> | string {
  const out: Record<string, number> = {};
  for (const p of participants) {
    const v = values?.[p];
    if (v === undefined || Number.isNaN(v)) return "fill in a value for every participant";
    out[p] = v;
  }
  return out;
}

/**
 * Mirror of the Go weightedShares engine (internal/domain/ledger/split.go):
 * floor(total*w/W) each, remainder yen by largest remainder, ties broken by
 * ascending member id. Kept in lockstep by transcribed Go test cases.
 */
export function previewShares(
  total: number,
  rule: SplitRule,
  participants: string[],
): Record<string, number> {
  if (rule.type === SplitMode.Exact) {
    const out: Record<string, number> = {};
    for (const p of participants) out[p] = rule.amounts[p] ?? 0;
    return out;
  }
  const weights: Record<string, number> = {};
  for (const p of participants) {
    weights[p] = rule.type === SplitMode.Equal ? 1 : (rule.weights[p] ?? 0);
  }
  const totalWeight = participants.reduce((a, p) => a + weights[p]!, 0);
  const shares: Record<string, number> = {};
  let assigned = 0;
  const remainders: { member: string; rem: number }[] = [];
  for (const p of participants) {
    const base = Math.floor((total * weights[p]!) / totalWeight);
    shares[p] = base;
    assigned += base;
    remainders.push({ member: p, rem: (total * weights[p]!) % totalWeight });
  }
  remainders.sort((x, y) => y.rem - x.rem || (x.member < y.member ? -1 : 1));
  for (let i = 0; i < total - assigned; i++) {
    shares[remainders[i]!.member]!++;
  }
  return shares;
}
