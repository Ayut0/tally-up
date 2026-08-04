"use client";

import { useSearchParams } from "next/navigation";
import { PrototypeVariantSwitcher, type Variant } from "./PrototypeVariantSwitcher";
import { SplitSectionAsIs } from "./SplitSectionAsIs.prototype";
import { SplitSectionRhf } from "./SplitSectionRhf.prototype";

type Props = {
  participantIds: string[];
  memberName: (id: string) => string;
  total: number | undefined;
};

/**
 * PROTOTYPE mount point for #141 — a comparison harness, separate from the
 * real split-mode section above (which stays wired to useAddExpenseForm and
 * the real submit button, untouched). Not wired to submission; the point is
 * to drive both variants against the same live participants/total and
 * react to the diff. Delete this file, its siblings, and the switcher once
 * #141 has a verdict — see NOTES.md.
 */
export function SplitSectionPrototype(props: Props) {
  const searchParams = useSearchParams();
  const variant = (searchParams.get("variant") === "rhf" ? "rhf" : "asis") satisfies Variant;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-amber-500/60 p-3 pb-16">
      <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
        PROTOTYPE — #141 RHF comparison, not wired to submit
      </p>
      {variant === "asis" ? <SplitSectionAsIs {...props} /> : <SplitSectionRhf {...props} />}
      <PrototypeVariantSwitcher variant={variant} />
    </div>
  );
}
