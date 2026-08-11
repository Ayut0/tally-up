/** Parses the total-amount field: must be a whole positive yen amount. */
export function parseTotal(input: string): { total: number; valid: boolean } {
  const total = Number(input);
  const valid = input.trim() !== "" && Number.isInteger(total) && total > 0;
  return { total, valid };
}

/**
 * Keeps the Total field's committed value digit-only, whether the character
 * arrived via keystroke or paste — the single mechanism behind "whole yen
 * only, no decimals, ever" (design-handoff.md §4), run from the field's
 * onChange rather than a separate keydown blocker.
 */
export function stripNonDigits(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

/** Whether the add-expense form has everything it needs to submit. */
export function canSubmitExpense(opts: {
  payerId: string;
  participantCount: number;
  totalValid: boolean;
  splitValid: boolean;
}): boolean {
  return opts.payerId !== "" && opts.participantCount > 0 && opts.totalValid && opts.splitValid;
}
