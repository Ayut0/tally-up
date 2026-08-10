import { Text } from "@/components/ui/text";
import type { HistoryRow } from "@/lib/history";

/** design-handoff.md: deleted/corrected entries never leave the list — they render struck-through, in place, permanently. */
function HistoryCard({ row }: { row: HistoryRow }) {
  if (row.struck) {
    return (
      <div className="flex items-center gap-3 rounded-[14px] border-[1.5px] border-dashed border-ink/[.15] bg-white/50 px-4 py-[13px]">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-ink/40 line-through">{row.label}</p>
          <p className="mt-[3px] text-[12px] font-medium text-ink/35">
            deleted — the ledger never forgets
          </p>
        </div>
        <span className="font-mono text-[15.5px] font-bold text-ink/35 tabular-nums line-through">
          {row.formattedAmount}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-[14px] border-[1.5px] border-ink/[.12] bg-surface px-4 py-[13px]">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold text-ink">{row.label}</p>
        <p className="mt-[3px] text-[12px] font-medium text-ink/50">
          {row.payerName} paid · {row.occurredOn}
        </p>
      </div>
      <span className="font-mono text-[15.5px] font-bold text-ink tabular-nums">
        {row.formattedAmount}
      </span>
    </div>
  );
}

export function HistoryList({ rows }: { rows: HistoryRow[] }) {
  return (
    <section className="flex flex-col gap-[10px]">
      <Text variant="label">History</Text>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.id}>
            <HistoryCard row={row} />
          </li>
        ))}
      </ul>
    </section>
  );
}
