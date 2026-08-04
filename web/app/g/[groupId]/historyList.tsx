import type { HistoryRow } from "@/lib/history";

export function HistoryList({ rows }: { rows: HistoryRow[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">History</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No entries yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li
              key={row.id}
              className={`flex items-center justify-between rounded-lg border border-black/[.08] px-4 py-2 dark:border-white/[.145] ${
                row.struck ? "line-through opacity-60" : ""
              }`}
            >
              <span className="flex flex-col">
                <span className="text-sm text-zinc-950 dark:text-zinc-50">{row.label}</span>
                <span className="text-xs text-zinc-500">
                  {row.payerName} · {row.occurredOn}
                </span>
              </span>
              <span className="text-sm text-zinc-950 dark:text-zinc-50">{row.formattedAmount}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
