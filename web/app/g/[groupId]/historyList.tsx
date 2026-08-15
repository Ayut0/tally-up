import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Text } from "@/components/ui/text";
import type { HistoryRow } from "@/lib/history";
import { PAGE_SIZES, type PageSize } from "./useGroupHistory";

const PAGE_SIZE_TABS = PAGE_SIZES.map((size) => ({ id: String(size), label: String(size) }));

/** design-handoff.md: deleted/corrected entries never leave the list — they render struck-through, in place, permanently. */
function HistoryCard({ row }: { row: HistoryRow }) {
  if (row.struck) {
    return (
      <div className="flex items-center gap-3 rounded-[14px] border-[1.5px] border-dashed border-ink/[.15] bg-white/50 px-4 py-[13px]">
        <div className="min-w-0 flex-1">
          <Text variant="body" className="text-[15px] font-bold text-ink/40 line-through">
            {row.label}
          </Text>
          <Text variant="body" className="mt-[3px] text-[12px] font-medium text-ink/35">
            deleted — the ledger never forgets
          </Text>
        </div>
        <Text
          variant="body"
          className="font-mono text-[15.5px] font-bold text-ink/35 tabular-nums line-through"
        >
          {row.formattedAmount}
        </Text>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-[14px] border-[1.5px] border-ink/[.12] bg-surface px-4 py-[13px]">
      <div className="min-w-0 flex-1">
        <Text variant="body" className="text-[15px] font-bold text-ink">
          {row.label}
        </Text>
        <Text variant="body" className="mt-[3px] text-[12px] font-medium text-ink/50">
          {row.payerName} paid · {row.occurredOn}
        </Text>
      </div>
      <Text variant="body" className="font-mono text-[15.5px] font-bold text-ink tabular-nums">
        {row.formattedAmount}
      </Text>
    </div>
  );
}

export function HistoryList({
  rows,
  pageSize,
  onPageSizeChange,
  hasMore,
  onLoadMore,
  isLoadingMore,
}: {
  rows: HistoryRow[];
  pageSize: PageSize;
  onPageSizeChange: (size: PageSize) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  isLoadingMore: boolean;
}) {
  return (
    <section className="flex flex-col gap-[10px]">
      <Text variant="label">History</Text>
      <Tabs
        tabs={PAGE_SIZE_TABS}
        value={String(pageSize)}
        onChange={(id) => onPageSizeChange(Number(id) as PageSize)}
      >
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.id}>
                <HistoryCard row={row} />
              </li>
            ))}
          </ul>
          {hasMore && (
            <Button variant="dashed" fullWidth onClick={onLoadMore} disabled={isLoadingMore}>
              {isLoadingMore ? "Loading…" : "Load more"}
            </Button>
          )}
        </div>
      </Tabs>
    </section>
  );
}
