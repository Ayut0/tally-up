import { describe, expect, it } from "vitest";
import { buildBalanceRows, diffChangedBalanceIds } from "./balance";

describe("buildBalanceRows", () => {
  const members = [
    { id: "m1", name: "Alice" },
    { id: "m2", name: "Bob" },
    { id: "m3", name: "Carol" },
  ];

  it("returns one row per member, in member order", () => {
    const rows = buildBalanceRows(members, [
      { member_id: "m1", balance: 500 },
      { member_id: "m2", balance: -500 },
      { member_id: "m3", balance: 0 },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("formats a positive balance in green with a + sign", () => {
    const [row] = buildBalanceRows(members, [{ member_id: "m1", balance: 1500 }]);
    expect(row.formattedAmount).toBe("+¥1,500");
    expect(row.amountClassName).toBe("text-positive");
  });

  it("formats a negative balance in red with a minus sign", () => {
    const [row] = buildBalanceRows(members, [{ member_id: "m1", balance: -1500 }]);
    expect(row.formattedAmount).toBe("−¥1,500");
    expect(row.amountClassName).toBe("text-negative");
  });

  it("formats a zero balance as neutral", () => {
    const [row] = buildBalanceRows(members, [{ member_id: "m1", balance: 0 }]);
    expect(row.amountClassName).toBe("text-zinc-500");
  });

  it("defaults a member with no balance entry to zero, neutral", () => {
    const [row] = buildBalanceRows(members, []);
    expect(row.formattedAmount).toBe("¥0");
    expect(row.amountClassName).toBe("text-zinc-500");
  });
});

describe("diffChangedBalanceIds", () => {
  it("returns nothing on the first poll (no previous snapshot)", () => {
    const changed = diffChangedBalanceIds(undefined, [{ member_id: "m1", balance: 500 }]);
    expect(changed).toEqual(new Set());
  });

  it("returns ids whose balance differs from the previous snapshot", () => {
    const previous = [
      { member_id: "m1", balance: 500 },
      { member_id: "m2", balance: -500 },
    ];
    const current = [
      { member_id: "m1", balance: 500 },
      { member_id: "m2", balance: -800 },
    ];
    expect(diffChangedBalanceIds(previous, current)).toEqual(new Set(["m2"]));
  });

  it("returns nothing when no balance changed", () => {
    const snapshot = [
      { member_id: "m1", balance: 500 },
      { member_id: "m2", balance: -500 },
    ];
    expect(diffChangedBalanceIds(snapshot, snapshot)).toEqual(new Set());
  });

  it("does not pulse a member with no entry in the previous snapshot", () => {
    const previous = [{ member_id: "m1", balance: 500 }];
    const current = [
      { member_id: "m1", balance: 500 },
      { member_id: "m2", balance: -200 },
    ];
    expect(diffChangedBalanceIds(previous, current)).toEqual(new Set());
  });
});
