import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import type { BalanceRow } from "@/lib/balance";

export function BalanceList({
  groupId,
  rows,
  currentMemberId,
}: {
  groupId: string;
  rows: BalanceRow[];
  currentMemberId?: string | null;
}) {
  return (
    <section className="flex flex-col gap-[10px]">
      <Text variant="label">Balances</Text>
      <Card>
        <ul className="divide-y divide-ink/[.08]">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-4 py-[14px]">
              <Avatar memberId={row.id} initial={row.name.charAt(0).toUpperCase()} />
              <Text variant="body" className="flex-1 text-[16px] font-bold text-ink">
                {row.name}
                {row.id === currentMemberId && (
                  <span className="ml-1 text-[12px] font-semibold text-ink/45">(you)</span>
                )}
              </Text>
              <Text
                variant="body"
                className={`font-mono text-[17px] font-bold tabular-nums ${row.amountClassName}`}
              >
                {row.formattedAmount}
              </Text>
            </li>
          ))}
        </ul>
      </Card>
      {/* Settling up, recording a payment, and viewing who-owes-whom are
          destinations, not creation acts, so they sit with the balances
          they act on rather than under the `+` (issue #157, #161, #185).
          Not part of the design handoff's 8 screens — left unstyled here,
          same as MemberList below, pending the design-QA pass (#57).
          flex-wrap: three links no longer reliably fit one row at
          max-w-sm. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Link
          href={`/g/${groupId}/settle`}
          className="self-start text-sm font-medium text-zinc-700 hover:underline dark:text-zinc-300"
        >
          Settle up →
        </Link>
        <Link
          href={`/g/${groupId}/record-payment`}
          className="self-start text-sm font-medium text-zinc-700 hover:underline dark:text-zinc-300"
        >
          Record a payment →
        </Link>
        <Link
          href={`/g/${groupId}/owes`}
          className="self-start text-sm font-medium text-zinc-700 hover:underline dark:text-zinc-300"
        >
          Who owes whom →
        </Link>
      </div>
    </section>
  );
}
