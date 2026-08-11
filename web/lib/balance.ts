import type { components } from "./api-types";

type Member = components["schemas"]["Member"];
type MemberBalance = components["schemas"]["MemberBalance"];

export type BalanceRow = {
  id: string;
  name: string;
  formattedAmount: string;
  amountClassName: string;
};

const POSITIVE_CLASS = "text-positive";
const NEGATIVE_CLASS = "text-negative";
const NEUTRAL_CLASS = "text-zinc-500";

/** design-handoff.md's signed form: `+¥6,200` / `−¥3,400` (a real minus sign, not a hyphen). */
function formatSignedYen(amount: number): string {
  if (amount === 0) return "¥0";
  const sign = amount > 0 ? "+" : "−";
  return `${sign}¥${Math.abs(amount).toLocaleString("ja-JP")}`;
}

/** One row per group member, in member order, joined against balances by id. */
export function buildBalanceRows(members: Member[], balances: MemberBalance[]): BalanceRow[] {
  const balanceByMember = new Map(balances.map((b) => [b.member_id, b.balance]));
  return members.map((member) => {
    const amount = balanceByMember.get(member.id) ?? 0;
    return {
      id: member.id,
      name: member.name,
      formattedAmount: formatSignedYen(amount),
      amountClassName: amount > 0 ? POSITIVE_CLASS : amount < 0 ? NEGATIVE_CLASS : NEUTRAL_CLASS,
    };
  });
}
