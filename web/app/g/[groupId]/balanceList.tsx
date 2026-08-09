import Link from "next/link";
import type { BalanceRow } from "@/lib/balance";

export function BalanceList({ groupId, rows }: { groupId: string; rows: BalanceRow[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Balances</h2>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-center justify-between rounded-lg border border-black/[.08] px-4 py-2 dark:border-white/[.145]"
          >
            <span className="text-base text-zinc-950 dark:text-zinc-50">{row.name}</span>
            <span className={row.amountClassName}>{row.formattedAmount}</span>
          </li>
        ))}
      </ul>
      {/* Settling up, recording a payment, and viewing who-owes-whom are
          destinations, not creation acts, so they sit with the balances
          they act on rather than under the `+` (issue #157, #161, #185).
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
