/**
 * Whole-yen display formatting — the app is yen-only today (the server
 * domain has no currency field), so this stays JPY-specific rather than
 * taking a currency parameter nothing yet uses.
 */
export function formatYen(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}
