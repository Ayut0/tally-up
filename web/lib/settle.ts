import type { components } from "./api-types";
import { EntryKind } from "./entry";

type Transfer = components["schemas"]["Transfer"];
type SettlementEntry = components["schemas"]["SettlementEntry"];

/**
 * Identity of one proposed transfer within a plan. The amount is part of it on
 * purpose: the plan is recomputed on every poll, so the same pair reappearing
 * for a different amount is a different proposal, not the same one refreshed.
 */
export function transferKey(transfer: Transfer): string {
  return `${transfer.from}:${transfer.to}:${transfer.amount}`;
}

/**
 * Builds the settlement that records `transfer` as proposed. The amount comes
 * straight off the transfer and there is no parameter to override it — the
 * settle screen offers no amount field, so a typo is unreachable there
 * (issue #147). A payment for a different amount is a separate act (#161).
 *
 * `requestedBy` is whoever tapped, which is deliberately not derivable from
 * the transfer: `payer_id` is who hands the money over, `requested_by` is who
 * recorded it happening, and under #146's creator-only rule the second one is
 * who may undo it. Conflating them is the inversion #159 fixed. The fields are
 * named rather than positional because `id` and `requestedBy` are both plain
 * UUID strings — nothing but the argument order would catch a transposition.
 */
export function settlementFor(
  transfer: Transfer,
  record: { id: string; requestedBy: string; occurredOn: string },
): SettlementEntry {
  return {
    kind: EntryKind.Settlement,
    id: record.id,
    requested_by: record.requestedBy,
    payer_id: transfer.from,
    counterparty: transfer.to,
    total_amount: transfer.amount,
    occurred_on: record.occurredOn,
  };
}
