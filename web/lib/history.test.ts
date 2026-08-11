import { describe, expect, it } from "vitest";
import { EntryKind } from "./entry";
import { buildHistoryRows } from "./history";

describe("buildHistoryRows", () => {
  const members = [
    { id: "m1", name: "Alice" },
    { id: "m2", name: "Bob" },
  ];

  const baseEntry = {
    seq: 1,
    payer_id: "m1",
    total_amount: 1000,
    participants: ["m1", "m2"],
    occurred_on: "2026-08-01",
    created_by: "m1",
    created_at: "2026-08-01T00:00:00Z",
    postings: [],
  };

  it("renders newest-first", () => {
    const rows = buildHistoryRows(members, [
      { ...baseEntry, id: "e1", kind: EntryKind.Expense },
      { ...baseEntry, id: "e2", kind: EntryKind.Expense },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["e2", "e1"]);
  });

  it("looks up the payer's name and formats the amount", () => {
    const [row] = buildHistoryRows(members, [{ ...baseEntry, id: "e1", kind: EntryKind.Expense }]);
    expect(row.payerName).toBe("Alice");
    expect(row.formattedAmount).toBe("¥1,000");
  });

  it("falls back to the raw payer id when the member is unknown", () => {
    const [row] = buildHistoryRows(members, [
      { ...baseEntry, id: "e1", kind: EntryKind.Expense, payer_id: "ghost" },
    ]);
    expect(row.payerName).toBe("ghost");
  });

  it("falls back to the entry kind as the label when there's no memo", () => {
    const [row] = buildHistoryRows(members, [{ ...baseEntry, id: "e1", kind: EntryKind.Expense }]);
    expect(row.label).toBe(EntryKind.Expense);
  });

  it("uses the memo as the label when present", () => {
    const [row] = buildHistoryRows(members, [
      { ...baseEntry, id: "e1", kind: EntryKind.Expense, memo: "Dinner" },
    ]);
    expect(row.label).toBe("Dinner");
  });

  it("drops the reversal entry itself — it's a bookkeeping artifact, not a user-facing row", () => {
    const rows = buildHistoryRows(members, [
      { ...baseEntry, id: "e1", kind: EntryKind.Expense },
      { ...baseEntry, id: "e2", kind: EntryKind.Reversal, reverses_id: "e1" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["e1"]);
  });

  it("marks the entry a reversal reverses as struck too", () => {
    const rows = buildHistoryRows(members, [
      { ...baseEntry, id: "e1", kind: EntryKind.Expense },
      { ...baseEntry, id: "e2", kind: EntryKind.Reversal, reverses_id: "e1" },
    ]);
    const reversed = rows.find((r) => r.id === "e1");
    expect(reversed?.struck).toBe(true);
  });

  it("leaves an untouched expense unstruck", () => {
    const [row] = buildHistoryRows(members, [{ ...baseEntry, id: "e1", kind: EntryKind.Expense }]);
    expect(row.struck).toBe(false);
  });
});
