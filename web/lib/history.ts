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

/** Newest-first history rows; a reversal, and the entry it reverses, both render struck-through. */
export function buildHistoryRows(members: Member[], entries: EntryRecord[]): HistoryRow[] {
  const membersById = new Map(members.map((m) => [m.id, m]));
  const reversedIds = new Set(
    entries
      .filter((e) => e.kind === EntryKind.Reversal && e.reverses_id)
      .map((e) => e.reverses_id!),
  );
  return [...entries].reverse().map((entry) => ({
    id: entry.id,
    label: entry.memo || entry.kind,
    payerName: membersById.get(entry.payer_id)?.name ?? entry.payer_id,
    occurredOn: entry.occurred_on,
    formattedAmount: `¥${entry.total_amount.toLocaleString("ja-JP")}`,
    struck: entry.kind === EntryKind.Reversal || reversedIds.has(entry.id),
  }));
}
