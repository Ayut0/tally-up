import type { components } from "./api-types";
import { EntryKind } from "./entry";

type Member = components["schemas"]["Member"];
type EntryRecord = components["schemas"]["EntryRecord"];

export type HistoryRow = {
  id: string;
  label: string;
  payerName: string;
  occurredOn: string;
  formattedAmount: string;
  struck: boolean;
};

/**
 * Newest-first history rows. A reversal is a ledger bookkeeping artifact —
 * the mechanism by which "deleting" an entry works without ever mutating
 * history (docs/architecture.md) — not something a user should see as its
 * own row, so it's dropped here; only the entry it reverses renders,
 * struck-through, in place.
 */
export function buildHistoryRows(members: Member[], entries: EntryRecord[]): HistoryRow[] {
  const membersById = new Map(members.map((m) => [m.id, m]));
  const reversedIds = new Set(
    entries
      .filter((e) => e.kind === EntryKind.Reversal && e.reverses_id)
      .map((e) => e.reverses_id!),
  );
  return [...entries]
    .filter((e) => e.kind !== EntryKind.Reversal)
    .reverse()
    .map((entry) => ({
      id: entry.id,
      label: entry.memo || entry.kind,
      payerName: membersById.get(entry.payer_id)?.name ?? entry.payer_id,
      occurredOn: entry.occurred_on,
      formattedAmount: `¥${entry.total_amount.toLocaleString("ja-JP")}`,
      struck: reversedIds.has(entry.id),
    }));
}
