/** Parses the total-amount field: must be a whole positive yen amount. */
export function parseTotal(input: string): { total: number; valid: boolean } {
  const total = Number(input);
  const valid = input.trim() !== "" && Number.isInteger(total) && total > 0;
  return { total, valid };
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
