"use client";

import { Button } from "@/components/ui/button";

/**
 * "Who shared it?" pill toggles (design-handoff.md §4, panel #1d). Selected =
 * filled ink bg + checkmark, per the mockup. The mockup only ever shows every
 * member selected, so it doesn't specify a deselected look; the light-track
 * treatment here reuses the Split control's own inactive-tab style (one
 * field below this one on the same screen — see ui/tabs.tsx) rather than
 * inventing an unrelated third color. The two looks live as
 * Button's "pillSelected"/"pillUnselected" variants.
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
        <Button
          key={row.id}
          variant={row.checked ? "pillSelected" : "pillUnselected"}
          aria-pressed={row.checked}
          onClick={() => onToggle(row.id)}
        >
          {row.checked && "✓ "}
          {row.name}
        </Button>
      ))}
    </div>
  );
}
