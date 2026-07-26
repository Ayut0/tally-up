import type { components } from "./api-types";

type SplitRule = components["schemas"]["SplitRule"];

type BuildInputs = {
  total?: number;
  amounts?: Record<string, number>;
  weights?: Record<string, number>;
};

/** Builds a SplitRule from form state, or returns a validation error string. */
export function buildSplitRule(
  mode: SplitRule["type"],
  participants: string[],
  inputs: BuildInputs,
): SplitRule | string {
  switch (mode) {
    case "equal":
      return { type: "equal" };
    case "exact": {
      const amounts = pick(inputs.amounts, participants);
      if (typeof amounts === "string") return amounts;
      const sum = Object.values(amounts).reduce((a, b) => a + b, 0);
      if (sum !== inputs.total) return `amounts sum to ¥${sum}, total is ¥${inputs.total}`;
      return { type: "exact", amounts };
    }
    case "shares": {
      const weights = pick(inputs.weights, participants);
      if (typeof weights === "string") return weights;
      if (Object.values(weights).some((v) => v <= 0 || !Number.isInteger(v)))
        return "shares must be positive whole numbers";
      return { type: "shares", weights };
    }
    case "percent": {
      const weights = pick(inputs.weights, participants);
      if (typeof weights === "string") return weights;
      if (Object.values(weights).some((v) => v <= 0 || !Number.isInteger(v)))
        return "percentages must be positive whole numbers";
      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      if (sum !== 100) return `percentages sum to ${sum}, must be 100`;
      return { type: "percent", weights };
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
  if (rule.type === "exact") {
    const out: Record<string, number> = {};
    for (const p of participants) out[p] = rule.amounts[p] ?? 0;
    return out;
  }
  const weights: Record<string, number> = {};
  for (const p of participants) {
    weights[p] = rule.type === "equal" ? 1 : (rule.weights[p] ?? 0);
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
