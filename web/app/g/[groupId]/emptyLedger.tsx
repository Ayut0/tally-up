/**
 * design-handoff.md's bonus empty state (`#1h`): a brand-new group with
 * zero expenses. The 4-bar glyph here is dimmed and never gets the
 * diagonal strike bar `Wordmark`'s `TallyGlyph` always renders, so it's
 * inline rather than a third `Wordmark` size for a rendering that never
 * repeats elsewhere.
 */
export function EmptyLedgerCard() {
  return (
    <div className="flex flex-col items-center gap-[14px] rounded-[18px] border-[1.5px] border-dashed border-ink/20 bg-surface px-5 py-9 text-center">
      <div className="flex h-[26px] items-end gap-[3px] opacity-80">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[26px] w-1 rounded-[2px] bg-[#e4d5b8]" />
        ))}
      </div>
      <p className="text-[17px] font-extrabold text-ink">A fresh ledger</p>
      <p className="max-w-[250px] text-[14px] leading-[1.5] font-medium text-ink/55">
        Everyone starts at ¥0. Add the first expense and balances appear here — exact, always.
      </p>
    </div>
  );
}
