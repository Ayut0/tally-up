import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import type { BalanceRow } from "@/lib/balance";

export function BalanceList({
  groupId,
  rows,
  currentMemberId,
  pulsingIds,
}: {
  groupId: string;
  rows: BalanceRow[];
  currentMemberId?: string | null;
  pulsingIds?: Set<string>;
}) {
  return (
    // aria-label, not a heading: the "Balances" caption is a Text "label"
    // variant (a <p>), so without this the section is an unnamed generic —
    // indistinguishable from History for a screen reader moving by landmark,
    // and for the E2E suite's role-based lookups (e2e/screens/groupScreen.ts).
    <section aria-label="Balances" className="flex flex-col gap-[10px]">
      <Text variant="label">Balances</Text>
      <Card>
        <ul className="divide-y divide-ink/[.08]">
          {rows.map((row) => (
            <li
              key={row.id}
              className={`flex items-center gap-3 px-4 py-[14px] ${
                pulsingIds?.has(row.id) ? "animate-balance-pulse" : ""
              }`}
            >
              <Avatar memberId={row.id} initial={row.name.charAt(0).toUpperCase()} />
              <div className="flex flex-1 items-baseline gap-1">
                <Text variant="body" className="text-[16px] font-bold text-ink">
                  {row.name}
                </Text>
                {row.id === currentMemberId && (
                  <Text variant="body" className="text-[12px] font-semibold text-ink/45">
                    (you)
                  </Text>
                )}
              </div>
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
          Not part of the design handoff's 8 screens, so not covered by the
          design-QA pass (#57) — styled to the warm palette separately
          (#229). flex-wrap: three links no longer reliably fit one row at
          max-w-sm. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Link
          href={`/g/${groupId}/settle`}
          className="self-start text-sm font-medium text-accent hover:underline"
        >
          Settle up →
        </Link>
        <Link
          href={`/g/${groupId}/record-payment`}
          className="self-start text-sm font-medium text-accent hover:underline"
        >
          Record a payment →
        </Link>
        <Link
          href={`/g/${groupId}/owes`}
          className="self-start text-sm font-medium text-accent hover:underline"
        >
          Who owes whom →
        </Link>
      </div>
    </section>
  );
}
