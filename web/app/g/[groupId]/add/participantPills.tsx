"use client";

/**
 * "Who shared it?" pill toggles (design-handoff.md §4, panel #1d). Selected =
 * filled ink bg + checkmark, per the mockup. The mockup only ever shows every
 * member selected, so it doesn't specify a deselected look; the light-track
 * treatment here reuses the Split control's own inactive-tab style (one
 * field below this one on the same screen — see ui/tabs.tsx) rather than
 * inventing an unrelated third color.
 *
 * Presentational only, per #138's "components may branch, but may not
 * compute": `rows` and `onToggle` are already decided by useAddExpenseForm.
 */
export function ParticipantPills({
  rows,
  onToggle,
}: {
  rows: { id: string; name: string; checked: boolean }[];
  onToggle: (memberId: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          aria-pressed={row.checked}
          onClick={() => onToggle(row.id)}
          className={
            row.checked
              ? "flex min-h-[38px] items-center gap-[7px] rounded-full bg-ink px-[14px] py-[9px] font-sans text-[14px] font-bold text-background"
              : "flex min-h-[38px] items-center gap-[7px] rounded-full bg-ink/[.08] px-[14px] py-[9px] font-sans text-[14px] font-bold text-ink/50"
          }
        >
          {row.checked && "✓ "}
          {row.name}
        </button>
      ))}
    </div>
  );
}
