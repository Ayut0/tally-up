import type { components } from "./api-types";

type Member = components["schemas"]["Member"];
type MemberBalance = components["schemas"]["MemberBalance"];

export type BalanceRow = {
  id: string;
  name: string;
  formattedAmount: string;
  amountClassName: string;
};

const POSITIVE_CLASS = "text-green-600 dark:text-green-400";
const NEGATIVE_CLASS = "text-red-600 dark:text-red-400";
const NEUTRAL_CLASS = "text-zinc-500";

/** One row per group member, in member order, joined against balances by id. */
export function buildBalanceRows(members: Member[], balances: MemberBalance[]): BalanceRow[] {
  const balanceByMember = new Map(balances.map((b) => [b.member_id, b.balance]));
  return members.map((member) => {
    const amount = balanceByMember.get(member.id) ?? 0;
    return {
      id: member.id,
      name: member.name,
      formattedAmount: `¥${amount.toLocaleString("ja-JP")}`,
      amountClassName: amount > 0 ? POSITIVE_CLASS : amount < 0 ? NEGATIVE_CLASS : NEUTRAL_CLASS,
    };
  });
}
